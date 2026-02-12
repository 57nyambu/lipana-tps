# SPDX-License-Identifier: Apache-2.0
"""
Database helpers — thin wrappers around psycopg2 for the three Tazama
PostgreSQL databases (evaluation, configuration, event_history).
"""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from typing import Any, Generator

import psycopg2
import psycopg2.extras

from app.config import settings

logger = logging.getLogger("lipana.db")


@contextmanager
def _get_conn(dsn: str) -> Generator:
    conn = psycopg2.connect(dsn)
    try:
        yield conn
    finally:
        conn.close()


# ------------------------------------------------------------------ #
#  Evaluation DB queries
# ------------------------------------------------------------------ #

def get_evaluation_by_msg_id(msg_id: str, tenant_id: str) -> dict | None:
    """Return the full evaluation JSONB for a given MsgId + tenant."""
    sql = """
        SELECT evaluation
          FROM evaluation
         WHERE "messageid" = %s
           AND "tenantid" = %s
         LIMIT 1;
    """
    with _get_conn(settings.eval_dsn) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (msg_id, tenant_id))
            row = cur.fetchone()
            return dict(row["evaluation"]) if row else None


def list_evaluations(
    tenant_id: str,
    limit: int = 50,
    offset: int = 0,
    status_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Return a paginated list of evaluations for a tenant."""
    conditions = ["\"tenantid\" = %s"]
    params: list[Any] = [tenant_id]

    if status_filter and status_filter in ("ALRT", "NALT"):
        conditions.append("evaluation->'report'->>'status' = %s")
        params.append(status_filter)

    where = " AND ".join(conditions)
    sql = f"""
        SELECT
            id,
            evaluation->>'transactionID'                   AS transaction_id,
            evaluation->'report'->>'status'                AS status,
            evaluation->'report'->>'evaluationID'          AS evaluation_id,
            evaluation->'report'->>'timestamp'             AS evaluated_at,
            evaluation->'report'->'tadpResult'->>'prcgTm'  AS processing_time_ns,
            evaluation->'report'->'tadpResult'->'typologyResult' AS typology_results
        FROM evaluation
        WHERE {where}
        ORDER BY id DESC
        LIMIT %s OFFSET %s;
    """
    params.extend([limit, offset])

    with _get_conn(settings.eval_dsn) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            return [dict(r) for r in rows]


def count_evaluations(tenant_id: str, status_filter: str | None = None) -> dict:
    """Return total, alert, and no-alert counts."""
    sql = """
        SELECT
            COUNT(*)                                                        AS total,
            COUNT(*) FILTER (WHERE evaluation->'report'->>'status' = 'ALRT') AS alerts,
            COUNT(*) FILTER (WHERE evaluation->'report'->>'status' = 'NALT') AS no_alerts
        FROM evaluation
        WHERE "tenantid" = %s;
    """
    with _get_conn(settings.eval_dsn) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (tenant_id,))
            row = cur.fetchone()
            return dict(row) if row else {"total": 0, "alerts": 0, "no_alerts": 0}


# ------------------------------------------------------------------ #
#  Event History DB queries
# ------------------------------------------------------------------ #

def count_transactions(tenant_id: str) -> int:
    """Count total transactions in event history for a tenant."""
    sql = """
        SELECT COUNT(*)::int AS cnt
          FROM transaction
         WHERE tenantid = %s;
    """
    with _get_conn(settings.event_dsn) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (tenant_id,))
            row = cur.fetchone()
            return row["cnt"] if row else 0
