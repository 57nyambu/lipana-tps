# SPDX-License-Identifier: Apache-2.0
"""
Lipana TPS — FastAPI application factory.
Accessible at: https://tazama.lipana.co
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.models import HealthResponse
from app.routes import dashboard, entry, exit as exit_routes, system

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("lipana")

BASE_DIR = Path(__file__).parent


def create_app() -> FastAPI:
    app = FastAPI(
        title="Lipana TPS",
        description=(
            "Transaction Processing Service — a secure wrapper around the "
            "Tazama fraud-monitoring pipeline.  Provides simplified entry/exit "
            "endpoints and a professional dashboard UI.\n\n"
            "**Production:** https://tazama.lipana.co"
        ),
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS — allow dashboard access from configured origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://tazama.lipana.co",
            "http://localhost:8100",
            "*",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Trusted hosts
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[
            "tazama.lipana.co",
            "localhost",
            "127.0.0.1",
            "*",
        ],
    )

    # Static files (CSS, JS, images)
    static_dir = BASE_DIR / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    # Health endpoint (no auth)
    @app.get("/health", response_model=HealthResponse, tags=["Health"])
    async def health() -> HealthResponse:
        db_status: dict[str, str] = {}
        for label, dsn in [
            ("evaluation", settings.eval_dsn),
            ("configuration", settings.config_dsn),
            ("event_history", settings.event_dsn),
        ]:
            try:
                import psycopg2
                conn = psycopg2.connect(dsn, connect_timeout=3)
                conn.close()
                db_status[label] = "ok"
            except Exception as exc:
                db_status[label] = f"error: {exc}"
        return HealthResponse(databases=db_status)

    # Mount routers
    app.include_router(dashboard.router)
    app.include_router(entry.router)
    app.include_router(exit_routes.router)
    app.include_router(system.router)

    logger.info("Lipana TPS ready — https://tazama.lipana.co — docs at /docs")
    return app


app = create_app()
