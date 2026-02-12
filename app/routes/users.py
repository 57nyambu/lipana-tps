# SPDX-License-Identifier: Apache-2.0
"""
User management routes — login, user CRUD, API key management.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import require_session, require_admin
from app.users import (
    UserCreateRequest,
    UserUpdateRequest,
    LoginRequest,
    LoginResponse,
    authenticate_user,
    create_access_token,
    create_user,
    delete_user,
    get_user,
    list_users,
    update_user,
    set_api_key_for_admin,
    get_api_key_from_admin,
)

logger = logging.getLogger("lipana.users.routes")
router = APIRouter(prefix="/api/v1/auth", tags=["Authentication & Users"])


# ── Login ─────────────────────────────────────────────────────

@router.post(
    "/login",
    response_model=LoginResponse,
    summary="User login",
    description="Authenticate with email and password. Returns a JWT session token.",
)
async def login(body: LoginRequest) -> LoginResponse:
    user = authenticate_user(body.email, body.password)
    if user is None:
        return LoginResponse(
            success=False,
            message="Invalid email or password",
        )

    token = create_access_token(user.email, user.role)
    return LoginResponse(
        success=True,
        token=token,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        message="Login successful",
    )


# ── Session Info ──────────────────────────────────────────────

@router.get(
    "/me",
    summary="Get current user info",
)
async def get_me(session: dict = Depends(require_session)) -> dict[str, Any]:
    user = get_user(session["sub"])
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "email": user.email,
        "role": user.role,
        "full_name": user.full_name,
        "is_active": user.is_active,
    }


# ── User Management (Admin Only) ─────────────────────────────

@router.get(
    "/users",
    summary="List all users",
    description="Admin only — list all system users.",
)
async def get_users(_admin: dict = Depends(require_admin)) -> dict[str, Any]:
    users = list_users()
    return {"total": len(users), "users": users}


@router.post(
    "/users",
    summary="Create a user",
    description="Admin only — create a new system user with email and default password.",
    status_code=status.HTTP_201_CREATED,
)
async def create_new_user(
    body: UserCreateRequest,
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    user = create_user(body)
    if user is None:
        raise HTTPException(status_code=409, detail="User with this email already exists")
    return {
        "success": True,
        "message": f"User {body.email} created with role '{body.role}'",
        "user": {
            "email": user.email,
            "role": user.role,
            "full_name": user.full_name,
        },
    }


@router.put(
    "/users/{email}",
    summary="Update a user",
    description="Admin only — update user role, name, status, or password.",
)
async def update_existing_user(
    email: str,
    body: UserUpdateRequest,
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    user = update_user(email, body)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "success": True,
        "message": f"User {email} updated",
        "user": {
            "email": user.email,
            "role": user.role,
            "full_name": user.full_name,
            "is_active": user.is_active,
        },
    }


@router.delete(
    "/users/{email}",
    summary="Delete a user",
    description="Admin only — remove a system user.",
)
async def delete_existing_user(
    email: str,
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    if email.lower() == _admin.get("sub", "").lower():
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    success = delete_user(email)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": f"User {email} deleted"}


# ── API Key Management (Admin Only) ──────────────────────────

@router.post(
    "/api-key",
    summary="Set TMS API key",
    description="Admin only — store the Tazama TMS API key used for all pipeline requests.",
)
async def set_api_key(
    body: dict,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    api_key = body.get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")

    set_api_key_for_admin(admin["sub"], api_key)
    return {"success": True, "message": "API key stored successfully"}


@router.get(
    "/api-key/status",
    summary="Check API key status",
    description="Admin only — check if a TMS API key is configured.",
)
async def check_api_key_status(
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    key = get_api_key_from_admin()
    return {
        "configured": bool(key),
        "key_preview": key[:8] + "..." if key and len(key) > 8 else ("***" if key else ""),
    }


# ── Change Own Password ──────────────────────────────────────

@router.post(
    "/change-password",
    summary="Change own password",
)
async def change_password(
    body: dict,
    session: dict = Depends(require_session),
) -> dict[str, Any]:
    new_password = body.get("new_password", "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user = update_user(session["sub"], UserUpdateRequest(password=new_password))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": "Password changed successfully"}
