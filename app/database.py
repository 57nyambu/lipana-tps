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

def _discover_eval_table(conn) -> str | None:
    """Discover the actual evaluation table name in the database.
    Returns None if no user tables exist yet."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        """)
        tables = [r[0] for r in cur.fetchall()]
        logger.info("Evaluation DB tables: %s", tables)
        if not tables:
            logger.info("No tables in evaluation DB — pipeline has not processed anything yet")
            return None
        # Try common Tazama table names
        for candidate in ["evaluationresult", "evaluationresults", "evaluation", "evaluations", "results"]:
            if candidate in tables:
                return candidate
        # Return first table if only one exists
        if len(tables) == 1:
            return tables[0]
        # Fallback
        return "evaluation"


# Cache the discovered table name — use sentinel to distinguish "not yet checked" from "checked, no tables"
_eval_table_checked = False
_eval_table_name: str | None = None


def _get_eval_table(conn) -> str | None:
    global _eval_table_name, _eval_table_checked
    if not _eval_table_checked:
        _eval_table_name = _discover_eval_table(conn)
        _eval_table_checked = True
        logger.info("Using evaluation table: %s", _eval_table_name)
    return _eval_table_name


def get_evaluation_by_msg_id(msg_id: str, tenant_id: str) -> dict | None:
    """Return the full evaluation JSONB for a given MsgId + tenant."""
    try:
        with _get_conn(settings.eval_dsn) as conn:
            tbl = _get_eval_table(conn)
            if tbl is None:
                return None
            sql = f"""
                SELECT evaluation
                  FROM {tbl}
                 WHERE "messageid" = %s
                   AND "tenantid" = %s
                 LIMIT 1;
            """
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (msg_id, tenant_id))
                row = cur.fetchone()
                return dict(row["evaluation"]) if row else None
    except Exception as exc:
        logger.warning("get_evaluation_by_msg_id failed: %s", exc)
        return None


def list_evaluations(
    tenant_id: str,
    limit: int = 50,
    offset: int = 0,
    status_filter: str | None = None,
) -> list[dict[str, Any]]:
    """Return a paginated list of evaluations for a tenant."""
    try:
        with _get_conn(settings.eval_dsn) as conn:
            tbl = _get_eval_table(conn)
            if tbl is None:
                return []
            conditions = ['"tenantid" = %s']
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
                FROM {tbl}
                WHERE {where}
                ORDER BY id DESC
                LIMIT %s OFFSET %s;
            """
            params.extend([limit, offset])

            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
                return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("list_evaluations failed: %s", exc)
        return []


def count_evaluations(tenant_id: str, status_filter: str | None = None) -> dict:
    """Return total, alert, and no-alert counts."""
    try:
        with _get_conn(settings.eval_dsn) as conn:
            tbl = _get_eval_table(conn)
            if tbl is None:
                return {"total": 0, "alerts": 0, "no_alerts": 0}
            sql = f"""
                SELECT
                    COUNT(*)                                                        AS total,
                    COUNT(*) FILTER (WHERE evaluation->'report'->>'status' = 'ALRT') AS alerts,
                    COUNT(*) FILTER (WHERE evaluation->'report'->>'status' = 'NALT') AS no_alerts
                FROM {tbl}
                WHERE "tenantid" = %s;
            """
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (tenant_id,))
                row = cur.fetchone()
                return dict(row) if row else {"total": 0, "alerts": 0, "no_alerts": 0}
    except Exception as exc:
        logger.warning("count_evaluations failed: %s", exc)
        return {"total": 0, "alerts": 0, "no_alerts": 0}


# ------------------------------------------------------------------ #
#  Event History DB queries
# ------------------------------------------------------------------ #

def count_transactions(tenant_id: str) -> int:
    """Count total transactions in event history for a tenant."""
    try:
        with _get_conn(settings.event_dsn) as conn:
            # Discover actual table name
            with conn.cursor() as tcur:
                tcur.execute("""
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                    ORDER BY table_name;
                """)
                tables = [r[0] for r in tcur.fetchall()]
                logger.info("Event history DB tables: %s", tables)

            if not tables:
                logger.info("No tables in event_history DB — no transactions yet")
                return 0

            tbl = "transaction"  # default
            for candidate in ["transactionhistory", "transaction_history", "transaction", "transactions"]:
                if candidate in tables:
                    tbl = candidate
                    break
            else:
                if len(tables) == 1:
                    tbl = tables[0]

            sql = f"""
                SELECT COUNT(*)::int AS cnt
                  FROM {tbl}
                 WHERE tenantid = %s;
            """
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, (tenant_id,))
                row = cur.fetchone()
                return row["cnt"] if row else 0
    except Exception as exc:
        logger.warning("count_transactions failed: %s", exc)
        return 0
