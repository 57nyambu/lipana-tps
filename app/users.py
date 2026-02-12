# SPDX-License-Identifier: Apache-2.0
"""
User management — JSON-file-backed user store with role-based access.
Roles: admin, operator
- admin: full access including API key config, user management, cluster ops
- operator: dashboard, submit transactions, view results (no cluster/system mgmt)
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field

logger = logging.getLogger("lipana.users")

# ── Password Hashing ─────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── JWT Settings ──────────────────────────────────────────────
JWT_SECRET_KEY = secrets.token_urlsafe(48)
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24

# ── User Store Path ──────────────────────────────────────────
USERS_FILE = Path(__file__).parent.parent / "users.json"

# ── Models ────────────────────────────────────────────────────

class UserRecord(BaseModel):
    email: str
    hashed_password: str
    role: str = "operator"  # admin | operator
    full_name: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_active: bool = True
    api_key: str = ""  # only admin stores the api key for TMS


class UserCreateRequest(BaseModel):
    email: str
    password: str
    role: str = "operator"
    full_name: str = ""


class UserUpdateRequest(BaseModel):
    role: str | None = None
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    success: bool
    token: str = ""
    email: str = ""
    role: str = ""
    full_name: str = ""
    message: str = ""


# ── Store Operations ──────────────────────────────────────────

def _load_users() -> dict[str, dict]:
    """Load users from JSON file."""
    if not USERS_FILE.exists():
        return {}
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.error("Failed to load users file: %s", exc)
        return {}


def _save_users(users: dict[str, dict]) -> None:
    """Save users to JSON file."""
    USERS_FILE.write_text(json.dumps(users, indent=2, default=str), encoding="utf-8")


def ensure_admin_exists() -> None:
    """Create default admin user if no users exist."""
    users = _load_users()
    if not users:
        admin_email = "admin@lipana.co"
        admin_pass = "admin123"
        users[admin_email] = UserRecord(
            email=admin_email,
            hashed_password=pwd_context.hash(admin_pass),
            role="admin",
            full_name="System Admin",
        ).model_dump()
        _save_users(users)
        logger.info(
            "Default admin created — email: %s  password: %s  (change immediately!)",
            admin_email, admin_pass,
        )


def get_user(email: str) -> UserRecord | None:
    """Get a user by email."""
    users = _load_users()
    data = users.get(email.lower().strip())
    if data:
        return UserRecord(**data)
    return None


def list_users() -> list[dict[str, Any]]:
    """List all users (without password hashes)."""
    users = _load_users()
    result = []
    for email, data in users.items():
        rec = {k: v for k, v in data.items() if k != "hashed_password"}
        result.append(rec)
    return result


def create_user(req: UserCreateRequest) -> UserRecord | None:
    """Create a new user. Returns None if email already exists."""
    users = _load_users()
    email = req.email.lower().strip()
    if email in users:
        return None
    record = UserRecord(
        email=email,
        hashed_password=pwd_context.hash(req.password),
        role=req.role,
        full_name=req.full_name,
    )
    users[email] = record.model_dump()
    _save_users(users)
    logger.info("User created: %s role=%s", email, req.role)
    return record


def update_user(email: str, req: UserUpdateRequest) -> UserRecord | None:
    """Update a user. Returns None if not found."""
    users = _load_users()
    email = email.lower().strip()
    if email not in users:
        return None
    data = users[email]
    if req.role is not None:
        data["role"] = req.role
    if req.full_name is not None:
        data["full_name"] = req.full_name
    if req.is_active is not None:
        data["is_active"] = req.is_active
    if req.password is not None:
        data["hashed_password"] = pwd_context.hash(req.password)
    users[email] = data
    _save_users(users)
    return UserRecord(**data)


def delete_user(email: str) -> bool:
    """Delete a user. Returns False if not found."""
    users = _load_users()
    email = email.lower().strip()
    if email not in users:
        return False
    del users[email]
    _save_users(users)
    logger.info("User deleted: %s", email)
    return True


def set_api_key_for_admin(email: str, api_key: str) -> bool:
    """Store the API key in the admin user record (encrypted at rest optional)."""
    users = _load_users()
    email = email.lower().strip()
    if email not in users:
        return False
    users[email]["api_key"] = api_key
    _save_users(users)
    return True


def get_api_key_from_admin() -> str:
    """Get the API key stored by any admin user."""
    users = _load_users()
    for data in users.values():
        if data.get("role") == "admin" and data.get("api_key"):
            return data["api_key"]
    return ""


# ── Authentication ────────────────────────────────────────────

def authenticate_user(email: str, password: str) -> UserRecord | None:
    """Verify email + password. Returns user record or None."""
    user = get_user(email)
    if user is None:
        return None
    if not user.is_active:
        return None
    if not pwd_context.verify(password, user.hashed_password):
        return None
    return user


def create_access_token(email: str, role: str) -> str:
    """Create a JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": email,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict | None:
    """Decode and verify a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None
