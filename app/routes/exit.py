# SPDX-License-Identifier: Apache-2.0
"""
Exit routes — retrieve evaluation results from the Tazama pipeline.

GET  /api/v1/results                  → paginated list
GET  /api/v1/results/{msg_id}         → single evaluation by MsgId
GET  /api/v1/results/stats/summary    → aggregate counters
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_api_key, require_session_with_api_key
from app.config import settings
from app.database import (
    count_evaluations,
    count_transactions,
    get_evaluation_by_msg_id,
    list_evaluations,
)
from app.models import (
    EvaluationDetail,
    EvaluationListResponse,
    StatsResponse,
)

logger = logging.getLogger("lipana.exit")
router = APIRouter(prefix="/api/v1/results", tags=["Exit — Results"])


@router.get(
    "",
    response_model=EvaluationListResponse,
    summary="List evaluation results",
    description="Paginated list of all evaluation results for a tenant.",
)
async def list_results(
    tenant_id: str = Query(default=None, description="Override tenant ID"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None, description="Filter by ALRT or NALT"),
    _key: str = Depends(require_session_with_api_key),
) -> EvaluationListResponse:
    tid = tenant_id or settings.default_tenant_id
    offset = (page - 1) * per_page

    rows = list_evaluations(tid, limit=per_page, offset=offset, status_filter=status)
    counts = count_evaluations(tid, status_filter=status)

    return EvaluationListResponse(
        tenant_id=tid,
        total=counts.get("total", 0),
        page=page,
        per_page=per_page,
        results=[EvaluationDetail(**r) for r in rows],
    )


@router.get(
    "/stats/summary",
    response_model=StatsResponse,
    summary="Evaluation statistics",
    description="Aggregate counts: total evaluations, alerts, no-alerts, event history transactions.",
)
async def stats_summary(
    tenant_id: str = Query(default=None),
    _key: str = Depends(require_session_with_api_key),
) -> StatsResponse:
    tid = tenant_id or settings.default_tenant_id
    counts = count_evaluations(tid)
    tx_count = count_transactions(tid)

    return StatsResponse(
        tenant_id=tid,
        evaluations_total=counts.get("total", 0),
        alerts=counts.get("alerts", 0),
        no_alerts=counts.get("no_alerts", 0),
        event_history_transactions=tx_count,
    )


@router.get(
    "/{msg_id}",
    summary="Get evaluation by Message ID",
    description="Retrieve the full evaluation result for a specific transaction MsgId.",
)
async def get_result(
    msg_id: str,
    tenant_id: str = Query(default=None),
    _key: str = Depends(require_session_with_api_key),
):
    tid = tenant_id or settings.default_tenant_id
    result = get_evaluation_by_msg_id(msg_id, tid)

    if result is None:
        raise HTTPException(status_code=404, detail=f"No evaluation found for MsgId={msg_id}")

    return {
        "tenant_id": tid,
        "msg_id": msg_id,
        "evaluation": result,
    }
