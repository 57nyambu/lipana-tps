<div align="center">

# ⚡ Lipana TPS

### Transaction Processing Service for the Tazama Fraud-Monitoring Pipeline

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-3776AB.svg?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?style=flat-square&logo=docker&logoColor=white)](Dockerfile)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-ready-326CE5.svg?style=flat-square&logo=kubernetes&logoColor=white)](k8s-deployment.yaml)

**Production URL:** [https://tazama.lipana.co](https://tazama.lipana.co)

---

</div>

## Overview

**Lipana TPS** is a secure, high-performance transaction processing service that acts as a streamlined gateway to the [Tazama](https://github.com/tazama-lf) fraud-monitoring pipeline. It transforms simplified transaction payloads into the ISO 20022 `pacs.002.001.12` format and forwards them to the Tazama Transaction Monitoring Service (TMS) for real-time fraud evaluation.

### Key Features

- **Simplified Transaction Entry** — Submit transactions with a friendly JSON payload; auto-converted to ISO 20022 pacs.002
- **Raw Pass-Through** — Forward pre-formatted ISO 20022 payloads directly to TMS
- **Evaluation Results** — Query paginated fraud evaluation results with status filtering
- **Real-Time Dashboard** — Professional dark-themed web UI with charts, stats, and data tables
- **API Key Authentication** — Secure access with configurable API keys and constant-time comparison
- **Multi-Tenant** — Built-in tenant isolation for multi-organization deployments
- **Health Monitoring** — Database connectivity health checks across all three PostgreSQL stores
- **Docker & Kubernetes** — Production-ready containerisation with K8s manifests

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    tazama.lipana.co                       │
│                                                          │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────┐   │
│  │  Nginx   │───▶│  Lipana   │───▶│   Tazama TMS     │   │
│  │  Reverse │    │   TPS     │    │  (pacs.002 eval)  │   │
│  │  Proxy   │    │  FastAPI  │    └──────────────────┘   │
│  └──────────┘    │  :8100    │                           │
│                  └─────┬─────┘                           │
│                        │                                 │
│              ┌─────────┼─────────┐                       │
│              ▼         ▼         ▼                       │
│       ┌──────────┐ ┌────────┐ ┌──────────┐              │
│       │Evaluation│ │ Config │ │  Event   │              │
│       │    DB    │ │   DB   │ │ History  │              │
│       │ postgres │ │postgres│ │ postgres │              │
│       └──────────┘ └────────┘ └──────────┘              │
└──────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Python 3.12+
- PostgreSQL (for Tazama pipeline databases)
- Access to a running Tazama TMS instance

### 1. Clone & Install

```bash
git clone https://github.com/lipana/lipana-tps.git
cd lipana-tps
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# Application
APP_HOST=0.0.0.0
APP_PORT=8100
LOG_LEVEL=info

# Authentication (comma-separated API keys)
API_KEYS=your-secure-api-key-here

# Tazama TMS
TMS_BASE_URL=http://gateway.tazama.svc.cluster.local:3000
TMS_TIMEOUT=30

# Evaluation DB
EVAL_DB_HOST=localhost
EVAL_DB_PORT=5432
EVAL_DB_NAME=evaluation
EVAL_DB_USER=postgres
EVAL_DB_PASSWORD=postgres

# Configuration DB
CONFIG_DB_HOST=localhost
CONFIG_DB_PORT=5432
CONFIG_DB_NAME=configuration
CONFIG_DB_USER=postgres
CONFIG_DB_PASSWORD=postgres

# Event History DB
EVENT_DB_HOST=localhost
EVENT_DB_PORT=5432
EVENT_DB_NAME=event_history
EVENT_DB_USER=postgres
EVENT_DB_PASSWORD=postgres

# Default Tenant
DEFAULT_TENANT_ID=DEFAULT
```

### 3. Run

```bash
python -m app
```

The service will start at `http://localhost:8100`:

| URL | Description |
|---|---|
| `/` | Login page |
| `/dashboard` | Main dashboard (after authentication) |
| `/docs` | Swagger UI (interactive API docs) |
| `/redoc` | ReDoc (alternative API docs) |
| `/health` | Health check endpoint |

---

## API Reference

### Authentication

All API endpoints require an `X-API-Key` header:

```bash
curl -H "X-API-Key: your-key" https://tazama.lipana.co/api/v1/results/stats/summary
```

### Endpoints

#### Entry — Submit Transactions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/transactions/evaluate` | Submit simplified transaction |
| `POST` | `/api/v1/transactions/evaluate/raw` | Submit raw pacs.002 payload |

**Simplified Transaction Example:**

```json
{
  "debtor_member": "dfsp001",
  "creditor_member": "dfsp002",
  "amount": 150.00,
  "currency": "USD",
  "status": "ACCC",
  "tenant_id": "DEFAULT"
}
```

#### Exit — Query Results

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/results` | Paginated evaluation results |
| `GET` | `/api/v1/results/stats/summary` | Aggregate statistics |
| `GET` | `/api/v1/results/{msg_id}` | Lookup by Message ID |

**Query Parameters:**

- `tenant_id` — Override default tenant
- `page` — Page number (default: 1)
- `per_page` — Results per page (1-100, default: 20)
- `status` — Filter by `ALRT` or `NALT`

#### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service & database health (no auth) |

---

## Dashboard

The web dashboard at `/dashboard` provides:

- **Overview** — Real-time stats cards, doughnut chart, quick actions
- **Results** — Paginated table of all evaluations with status filtering
- **Submit Transaction** — Form to submit transactions through the pipeline
- **Lookup** — Search evaluation results by Message ID
- **Settings** — Connection configuration and links

The dashboard uses a dark professional theme and is fully responsive.

---

## Deployment

### Docker

```bash
# Build
docker build -t lipana-tps:latest .

# Run
docker run -d \
  --name lipana-tps \
  -p 8100:8100 \
  --env-file .env \
  lipana-tps:latest
```

### Docker Compose

```bash
docker-compose up -d
```

### Kubernetes

The included `k8s-deployment.yaml` deploys the service into the `tazama` namespace:

```bash
kubectl apply -f k8s-deployment.yaml
```

This creates:
- A `Deployment` with health/readiness probes
- A `NodePort` Service on port 30810
- An `Ingress` for `tazama.lipana.co` (requires an Ingress controller)

### Production Deployment Script

Use the included deployment script for automated production deployment:

```bash
chmod +x deploy.sh
./deploy.sh
```

The script handles:
1. Building the Docker image
2. Deploying to Kubernetes
3. Configuring the Ingress for `tazama.lipana.co`
4. Running health checks
5. Optional rollback on failure

See the [Deployment Guide](GUIDE.md) for full details.

---

## Project Structure

```
lipana-tps/
├── app/
│   ├── __init__.py
│   ├── __main__.py          # CLI entrypoint (python -m app)
│   ├── auth.py              # API key authentication
│   ├── config.py            # Environment configuration
│   ├── database.py          # PostgreSQL query helpers
│   ├── main.py              # FastAPI app factory
│   ├── models.py            # Pydantic models (ISO 20022)
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── dashboard.py     # HTML page routes
│   │   ├── entry.py         # Transaction submit endpoints
│   │   └── exit.py          # Evaluation query endpoints
│   ├── static/
│   │   ├── css/
│   │   │   └── style.css    # Dark professional theme
│   │   └── js/
│   │       └── app.js       # Dashboard SPA logic
│   └── templates/
│       ├── dashboard.html   # Legacy dashboard (preserved)
│       ├── dashboard_new.html # Professional dashboard SPA
│       └── login.html       # Authentication page
├── deploy.sh                # Production deployment script
├── docker-compose.yml       # Local development compose
├── Dockerfile               # Container build
├── GUIDE.md                 # Detailed deployment guide
├── k8s-deployment.yaml      # Kubernetes manifests
├── README.md                # This file
└── requirements.txt         # Python dependencies
```

---

## Security

- **API Key Authentication** — All API endpoints are protected by `X-API-Key` header validation
- **Constant-Time Comparison** — API keys are compared using `secrets.compare_digest()` to prevent timing attacks
- **CORS Configuration** — Configurable allowed origins (defaults to `tazama.lipana.co`)
- **Trusted Hosts** — Middleware validates request `Host` headers
- **Non-Root Container** — Docker image runs as an unprivileged `lipana` user
- **No Secrets in Code** — All credentials loaded from environment variables

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_HOST` | `0.0.0.0` | Bind address |
| `APP_PORT` | `8100` | Bind port |
| `LOG_LEVEL` | `info` | Logging level |
| `API_KEYS` | `change-me-...` | Comma-separated valid API keys |
| `TMS_BASE_URL` | `http://gateway.tazama...` | Tazama TMS endpoint |
| `TMS_TIMEOUT` | `30` | TMS request timeout (seconds) |
| `EVAL_DB_*` | — | Evaluation database connection |
| `CONFIG_DB_*` | — | Configuration database connection |
| `EVENT_DB_*` | — | Event history database connection |
| `DEFAULT_TENANT_ID` | `DEFAULT` | Fallback tenant identifier |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.12, FastAPI, Uvicorn |
| Database | PostgreSQL (psycopg2) |
| HTTP Client | httpx (async) |
| Frontend | Vanilla JS, Chart.js, Custom CSS |
| Container | Docker (Python 3.12-slim) |
| Orchestration | Kubernetes |
| Reverse Proxy | Nginx (production) |

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

---

<div align="center">

**Built for the [Tazama](https://github.com/tazama-lf) fraud-monitoring ecosystem**

[Report an Issue](https://github.com/lipana/lipana-tps/issues) · [API Docs](https://tazama.lipana.co/docs) · [Dashboard](https://tazama.lipana.co/dashboard)

</div>
