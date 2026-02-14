# SPDX-License-Identifier: Apache-2.0
"""
Entry route — submit transactions into the Tazama pipeline.

POST /api/v1/transactions/evaluate      → simplified friendly body
POST /api/v1/transactions/evaluate/raw  → pass-through raw pacs.002
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends

from app.auth import require_api_key, require_session_with_api_key
from app.config import settings
from app.models import (
    RawPacs002Request,
    SimpleTransactionRequest,
    TransactionSubmitResponse,
)

logger = logging.getLogger("lipana.entry")
router = APIRouter(prefix="/api/v1/transactions", tags=["Entry — Submit"])


async def _forward_to_tms(payload: dict[str, Any], tenant_id: str, msg_type: str = "pacs.002.001.12") -> dict:
    """POST an ISO 20022 payload to the Tazama TMS service."""
    url = f"{settings.tms_base_url}/v1/evaluate/iso20022/{msg_type}"
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    async with httpx.AsyncClient(timeout=settings.tms_timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


@router.post(
    "/evaluate",
    response_model=TransactionSubmitResponse,
    summary="Evaluate a transaction (simplified)",
    description=(
        "Accepts a simplified transaction payload, transforms it into "
        "the ISO 20022 pacs.002.001.12 format, and forwards it to the "
        "Tazama TMS for fraud evaluation."
    ),
)
async def evaluate_simple(
    body: SimpleTransactionRequest,
    _key: str = Depends(require_session_with_api_key),
) -> TransactionSubmitResponse:
    from uuid import uuid4

    tenant = body.resolved_tenant(settings.default_tenant_id)
    # Shared EndToEndId links the pacs.008 and pacs.002 together
    end_to_end_id = uuid4().hex

    # Step 1: Send pacs.008 (credit transfer) — creates accounts/entities
    pacs008 = body.to_pacs008(tenant, end_to_end_id)
    pacs008_msg_id = pacs008["FIToFICstmrCdtTrf"]["GrpHdr"]["MsgId"]
    logger.info("Step 1: Sending pacs.008 %s for tenant %s", pacs008_msg_id, tenant)

    try:
        await _forward_to_tms(pacs008, tenant, "pacs.008.001.10")
    except httpx.HTTPStatusError as exc:
        logger.error("TMS pacs.008 returned %s: %s", exc.response.status_code, exc.response.text)
        return TransactionSubmitResponse(
            success=False,
            message=f"TMS pacs.008 error: {exc.response.status_code}",
            msg_id=pacs008_msg_id,
            tms_response={"error": exc.response.text},
        )
    except httpx.RequestError as exc:
        logger.error("Failed to reach TMS for pacs.008: %s", exc)
        return TransactionSubmitResponse(
            success=False,
            message=f"Cannot reach TMS at {settings.tms_base_url}: {exc}",
            msg_id=pacs008_msg_id,
        )

    # Step 2: Send pacs.002 (payment status) — triggers evaluation
    pacs002 = body.to_pacs002(tenant, end_to_end_id)
    msg_id = pacs002["FIToFIPmtSts"]["GrpHdr"]["MsgId"]
    logger.info("Step 2: Sending pacs.002 %s for tenant %s (E2E: %s)", msg_id, tenant, end_to_end_id)

    try:
        tms_resp = await _forward_to_tms(pacs002, tenant, "pacs.002.001.12")
        return TransactionSubmitResponse(
            success=True,
            message="Transaction submitted to Tazama pipeline",
            msg_id=msg_id,
            tms_response=tms_resp,
        )
    except httpx.HTTPStatusError as exc:
        logger.error("TMS pacs.002 returned %s: %s", exc.response.status_code, exc.response.text)
        return TransactionSubmitResponse(
            success=False,
            message=f"TMS pacs.002 error: {exc.response.status_code}",
            msg_id=msg_id,
            tms_response={"error": exc.response.text},
        )
    except httpx.RequestError as exc:
        logger.error("Failed to reach TMS for pacs.002: %s", exc)
        return TransactionSubmitResponse(
            success=False,
            message=f"Cannot reach TMS at {settings.tms_base_url}: {exc}",
            msg_id=msg_id,
        )


@router.post(
    "/evaluate/raw",
    response_model=TransactionSubmitResponse,
    summary="Evaluate a transaction (raw pacs.002)",
    description=(
        "Pass a raw ISO 20022 pacs.002.001.12 payload directly to TMS "
        "without any transformation."
    ),
)
async def evaluate_raw(
    body: RawPacs002Request,
    _key: str = Depends(require_session_with_api_key),
) -> TransactionSubmitResponse:
    tenant = body.tenant_id or settings.default_tenant_id
    payload = body.payload.model_dump(by_alias=True)
    msg_id = payload["FIToFIPmtSts"]["GrpHdr"]["MsgId"]

    logger.info("Submitting raw pacs.002 %s for tenant %s", msg_id, tenant)

    try:
        tms_resp = await _forward_to_tms(payload, tenant)
        return TransactionSubmitResponse(
            success=True,
            message="Raw pacs.002 submitted to Tazama pipeline",
            msg_id=msg_id,
            tms_response=tms_resp,
        )
    except httpx.HTTPStatusError as exc:
        logger.error("TMS returned %s: %s", exc.response.status_code, exc.response.text)
        return TransactionSubmitResponse(
            success=False,
            message=f"TMS error: {exc.response.status_code}",
            msg_id=msg_id,
            tms_response={"error": exc.response.text},
        )
    except httpx.RequestError as exc:
        logger.error("Failed to reach TMS: %s", exc)
        return TransactionSubmitResponse(
            success=False,
            message=f"Cannot reach TMS at {settings.tms_base_url}: {exc}",
            msg_id=msg_id,
        )
