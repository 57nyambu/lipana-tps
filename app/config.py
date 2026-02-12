# SPDX-License-Identifier: Apache-2.0
"""
Lipana TPS — Application configuration via environment variables.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8100
    log_level: str = "info"

    # API Security — comma-separated keys
    api_keys: str = "change-me-generate-a-real-key"

    # Tazama TMS
    tms_base_url: str = "http://gateway.tazama.svc.cluster.local:3000"
    tms_timeout: int = 30

    # Evaluation DB
    eval_db_host: str = "postgres.tazama.svc.cluster.local"
    eval_db_port: int = 5432
    eval_db_name: str = "evaluation"
    eval_db_user: str = "postgres"
    eval_db_password: str = "postgres"

    # Configuration DB
    config_db_host: str = "postgres.tazama.svc.cluster.local"
    config_db_port: int = 5432
    config_db_name: str = "configuration"
    config_db_user: str = "postgres"
    config_db_password: str = "postgres"

    # Event History DB
    event_db_host: str = "postgres.tazama.svc.cluster.local"
    event_db_port: int = 5432
    event_db_name: str = "event_history"
    event_db_user: str = "postgres"
    event_db_password: str = "postgres"

    # Default tenant
    default_tenant_id: str = "DEFAULT"

    # Kubernetes
    k8s_namespace: str = "tazama"
    k8s_in_cluster: bool = True
    k8s_kubeconfig: str = ""  # path to kubeconfig if not in-cluster

    # Derived helpers
    @property
    def api_key_list(self) -> list[str]:
        return [k.strip() for k in self.api_keys.split(",") if k.strip()]

    @property
    def eval_dsn(self) -> str:
        return (
            f"host={self.eval_db_host} port={self.eval_db_port} "
            f"dbname={self.eval_db_name} user={self.eval_db_user} "
            f"password={self.eval_db_password}"
        )

    @property
    def config_dsn(self) -> str:
        return (
            f"host={self.config_db_host} port={self.config_db_port} "
            f"dbname={self.config_db_name} user={self.config_db_user} "
            f"password={self.config_db_password}"
        )

    @property
    def event_dsn(self) -> str:
        return (
            f"host={self.event_db_host} port={self.event_db_port} "
            f"dbname={self.event_db_name} user={self.event_db_user} "
            f"password={self.event_db_password}"
        )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
