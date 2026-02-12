# SPDX-License-Identifier: Apache-2.0
"""
API-key security middleware + JWT session auth.
- API routes use the API key stored by admin for TMS communication
- Dashboard/session routes use JWT tokens
"""

from __future__ import annotations

import secrets
import logging

from fastapi import HTTPException, Security, Depends, status, Request
from fastapi.security import APIKeyHeader

from app.config import settings
from app.users import verify_token, get_api_key_from_admin

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


async def require_session(request: Request) -> dict:
    """Dependency that validates JWT session token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid session token",
        )
    token = auth_header[7:]
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
        )
    return payload


async def require_admin(session: dict = Depends(require_session)) -> dict:
    """Dependency that requires admin role."""
    if session.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return session


async def require_session_with_api_key(request: Request) -> str:
    """
    Dependency for API routes called from the dashboard.
    Validates JWT session, then uses the admin-stored API key for TMS calls.
    Also accepts direct API key for backwards compatibility.
    """
    # First try direct API key
    api_key = request.headers.get("X-API-Key")
    if api_key:
        valid = any(
            secrets.compare_digest(api_key, expected)
            for expected in settings.api_key_list
        )
        if valid:
            return api_key

    # Then try JWT session
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        payload = verify_token(token)
        if payload:
            # Use admin-stored API key
            stored_key = get_api_key_from_admin()
            if stored_key:
                return stored_key
            # Check if it's in settings (backwards compat)
            if settings.api_key_list:
                return settings.api_key_list[0]

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
    )
