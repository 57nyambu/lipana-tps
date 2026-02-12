# SPDX-License-Identifier: Apache-2.0
"""
API-key security middleware.
Validates the ``X-API-Key`` header on every protected route.
"""

from __future__ import annotations

import secrets
import logging

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

from app.config import settings

logger = logging.getLogger("lipana.auth")

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(
    api_key: str | None = Security(_api_key_header),
) -> str:
    """Dependency that validates the API key from the request header."""
    if api_key is None:
        logger.warning("Request missing X-API-Key header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key — provide X-API-Key header",
        )

    # Constant-time comparison to prevent timing attacks
    valid = any(
        secrets.compare_digest(api_key, expected)
        for expected in settings.api_key_list
    )

    if not valid:
        logger.warning("Invalid API key attempted: %s…", api_key[:8])
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )

    return api_key
