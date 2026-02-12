# SPDX-License-Identifier: Apache-2.0
"""
Dashboard routes — serves the login page and the main dashboard SPA.
No API key required for the pages themselves; the JS in the pages
sends the key with each API call.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["Dashboard"])

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
_LOGIN_TEMPLATE = (_TEMPLATES_DIR / "login.html").read_text()
_DASHBOARD_TEMPLATE = (_TEMPLATES_DIR / "dashboard_new.html").read_text()


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def login_page(request: Request) -> HTMLResponse:
    """Landing page — API key authentication."""
    return HTMLResponse(_LOGIN_TEMPLATE)


@router.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def dashboard(request: Request) -> HTMLResponse:
    """Main dashboard SPA."""
    return HTMLResponse(_DASHBOARD_TEMPLATE)

