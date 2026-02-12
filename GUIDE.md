# Lipana TPS — Development & Deployment Guide

> **Transaction Processing Service** — A secure Python wrapper around the Tazama
> fraud-monitoring pipeline with entry/exit endpoints and a visual dashboard.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Project Structure](#3-project-structure)
4. [Configuration Reference](#4-configuration-reference)
5. [Local Development](#5-local-development)
6. [API Reference](#6-api-reference)
7. [Dashboard UI](#7-dashboard-ui)
8. [Security — API Keys](#8-security--api-keys)
9. [Docker Build & Run](#9-docker-build--run)
10. [Kubernetes Deployment (Your VPS)](#10-kubernetes-deployment-your-vps)
11. [End-to-End Test Walkthrough](#11-end-to-end-test-walkthrough)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your VPS (Kubernetes)                     │
│                                                                  │
│  ┌──────────────┐      ┌─────────┐     ┌──────────────────────┐ │
│  │              │ POST │         │NATS │  event-director       │ │
│  │  Lipana TPS  │─────▶│   TMS   │────▶│  rule-901 / rule-902 │ │
│  │  (wrapper)   │      │ :3000   │     │  typology-processor  │ │
│  │  :8100       │      └─────────┘     │  TADProc             │ │
│  │              │                       └──────────┬───────────┘ │
│  │  ┌─────────┐ │                                  │             │
│  │  │Dashboard│ │     ┌────────────┐               │             │
│  │  │   UI    │ │◀────│ PostgreSQL │◀──────────────┘             │
│  │  └─────────┘ │     │ evaluation │  saves result              │
│  └──────────────┘     │ config     │                             │
│        ▲              │ event_hist │                             │
│        │              └────────────┘                             │
│     NodePort                                                     │
│      :30810                                                      │
└────────┼────────────────────────────────────────────────────────┘
         │
    External Access
    http://<VPS_IP>:30810
```

### What Lipana TPS Does

| Direction | Endpoint | Purpose |
|-----------|----------|---------|
| **Entry** | `POST /api/v1/transactions/evaluate` | Accept a simplified transaction, transform it to ISO 20022 pacs.002, forward to Tazama TMS |
| **Entry** | `POST /api/v1/transactions/evaluate/raw` | Pass a raw pacs.002 directly to TMS |
| **Exit**  | `GET /api/v1/results` | List evaluation results from the evaluation database |
| **Exit**  | `GET /api/v1/results/{msg_id}` | Get full evaluation detail for a specific transaction |
| **Exit**  | `GET /api/v1/results/stats/summary` | Get aggregate statistics (totals, alerts, no-alerts) |
| **UI**    | `GET /` | Visual dashboard |

---

## 2. Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | 3.12 recommended |
| Docker | 20+ | For container build |
| kubectl | 1.25+ | Access to your Tazama namespace |
| Tazama pipeline | Running | TMS, event-director, rules, typology-processor, TADProc |
| PostgreSQL | Running | With `evaluation`, `configuration`, `event_history` databases |

Your existing Tazama setup on the VPS must be fully operational (which it is after our previous debugging session).

---

## 3. Project Structure

```
lipana-tps/
├── app/
│   ├── __init__.py            # Package marker
│   ├── __main__.py            # Entrypoint: python -m app
│   ├── main.py                # FastAPI app factory
│   ├── config.py              # Settings via environment variables
│   ├── auth.py                # API key validation middleware
│   ├── database.py            # PostgreSQL query helpers
│   ├── models.py              # Pydantic request/response models
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── entry.py           # POST — submit transactions
│   │   ├── exit.py            # GET  — retrieve results
│   │   └── dashboard.py       # GET  — serve HTML dashboard
│   └── templates/
│       └── dashboard.html     # Single-page dashboard UI
├── .env.template              # Environment variable template
├── .gitignore
├── .dockerignore
├── Dockerfile                 # Production container image
├── docker-compose.yml         # Local dev convenience
├── k8s-deployment.yaml        # Kubernetes deployment + service
├── requirements.txt           # Python dependencies
└── GUIDE.md                   # ← This file
```

---

## 4. Configuration Reference

All configuration is via environment variables (or a `.env` file for local dev).

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_HOST` | `0.0.0.0` | Bind address |
| `APP_PORT` | `8100` | HTTP port |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warning, error) |
| `API_KEYS` | `change-me…` | Comma-separated API keys |
| `TMS_BASE_URL` | `http://gateway.tazama.svc.cluster.local:3000` | Tazama TMS URL |
| `TMS_TIMEOUT` | `30` | HTTP timeout (seconds) to TMS |
| `EVAL_DB_HOST` | `postgres.tazama.svc.cluster.local` | Evaluation DB host |
| `EVAL_DB_PORT` | `5432` | Evaluation DB port |
| `EVAL_DB_NAME` | `evaluation` | Evaluation DB name |
| `EVAL_DB_USER` | `postgres` | Evaluation DB user |
| `EVAL_DB_PASSWORD` | `postgres` | Evaluation DB password |
| `CONFIG_DB_HOST` | `postgres.tazama.svc.cluster.local` | Configuration DB host |
| `CONFIG_DB_PORT` | `5432` | Configuration DB port |
| `CONFIG_DB_NAME` | `configuration` | Configuration DB name |
| `CONFIG_DB_USER` | `postgres` | Configuration DB user |
| `CONFIG_DB_PASSWORD` | `postgres` | Configuration DB password |
| `EVENT_DB_HOST` | `postgres.tazama.svc.cluster.local` | Event history DB host |
| `EVENT_DB_PORT` | `5432` | Event history DB port |
| `EVENT_DB_NAME` | `event_history` | Event history DB name |
| `EVENT_DB_USER` | `postgres` | Event history DB user |
| `EVENT_DB_PASSWORD` | `postgres` | Event history DB password |
| `DEFAULT_TENANT_ID` | `DEFAULT` | Fallback tenant when none provided |

---

## 5. Local Development

### 5.1 Clone / copy the project

```bash
cd ~/Desktop
ls lipana-tps/
```

### 5.2 Create your `.env`

```bash
cd lipana-tps
cp .env.template .env
```

Edit `.env` — for local dev pointing at your VPS, you'll need the VPS PostgreSQL and TMS accessible. Options:

**Option A — kubectl port-forward (recommended for dev):**

```bash
# Terminal 1: forward TMS
kubectl -n tazama port-forward svc/gateway 3000:3000

# Terminal 2: forward PostgreSQL
kubectl -n tazama port-forward svc/postgres 5432:5432
```

Then in `.env`:
```
TMS_BASE_URL=http://127.0.0.1:3000
EVAL_DB_HOST=127.0.0.1
CONFIG_DB_HOST=127.0.0.1
EVENT_DB_HOST=127.0.0.1
```

**Option B — Deploy directly to K8s** (see Section 10).

### 5.3 Install dependencies

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

pip install -r requirements.txt
```

### 5.4 Generate an API key

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the output and paste into your `.env`:
```
API_KEYS=your-generated-key-here
```

### 5.5 Run the server

```bash
python -m app
```

Output:
```
INFO:     Uvicorn running on http://0.0.0.0:8100
INFO:     lipana   Lipana TPS ready — docs at /docs, dashboard at /
```

### 5.6 Access

| URL | What |
|-----|------|
| http://localhost:8100 | Dashboard UI |
| http://localhost:8100/docs | Swagger API docs |
| http://localhost:8100/redoc | ReDoc API docs |
| http://localhost:8100/health | Health check (no auth) |

---

## 6. API Reference

### 6.1 Authentication

All API endpoints (except `/health` and `/` dashboard) require the `X-API-Key` header:

```
X-API-Key: your-api-key-here
```

Responses for invalid/missing key:
- `401` — Missing API key
- `403` — Invalid API key

### 6.2 Entry Endpoints

#### `POST /api/v1/transactions/evaluate` — Simplified submission

Send a human-friendly payload; Lipana transforms it to ISO 20022 pacs.002 and forwards to TMS.

**Request:**
```bash
curl -X POST http://localhost:8100/api/v1/transactions/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "debtor_member": "dfsp001",
    "creditor_member": "dfsp002",
    "amount": 100.50,
    "currency": "USD",
    "status": "ACCC",
    "tenant_id": "DEFAULT"
  }'
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `debtor_member` | string | ✅ | Sender's DFSP ID |
| `creditor_member` | string | ✅ | Receiver's DFSP ID |
| `amount` | float | ✅ | Transaction amount (> 0) |
| `currency` | string | ❌ | ISO 4217 code (default: USD) |
| `status` | string | ❌ | `ACCC` (accepted) or `RJCT` (rejected) — default: ACCC |
| `tenant_id` | string | ❌ | Tenant override (default: server setting) |

**Response (200):**
```json
{
  "success": true,
  "message": "Transaction submitted to Tazama pipeline",
  "msg_id": "a1b2c3d4e5f6...",
  "tms_response": {
    "message": "Transaction is valid",
    "data": { "...pacs.002 echo..." }
  }
}
```

#### `POST /api/v1/transactions/evaluate/raw` — Raw pacs.002 passthrough

For power users who want full control over the ISO 20022 payload:

```bash
curl -X POST http://localhost:8100/api/v1/transactions/evaluate/raw \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "tenant_id": "DEFAULT",
    "payload": {
      "FIToFIPmtSts": {
        "GrpHdr": {
          "MsgId": "custom-id-here",
          "CreDtTm": "2026-02-11T14:00:00.000Z"
        },
        "TxInfAndSts": {
          "OrgnlInstrId": "abc123",
          "OrgnlEndToEndId": "def456",
          "TxSts": "ACCC",
          "ChrgsInf": [],
          "AccptncDtTm": "2026-02-11T14:00:00.000Z",
          "InstgAgt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": "dfsp001"}}},
          "InstdAgt": {"FinInstnId": {"ClrSysMmbId": {"MmbId": "dfsp002"}}}
        }
      }
    }
  }'
```

### 6.3 Exit Endpoints

#### `GET /api/v1/results` — List evaluations

```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:8100/api/v1/results?page=1&per_page=20&status=ALRT&tenant_id=DEFAULT"
```

**Query Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `page` | 1 | Page number |
| `per_page` | 20 | Results per page (max 100) |
| `status` | *(all)* | Filter: `ALRT` or `NALT` |
| `tenant_id` | server default | Tenant ID override |

**Response (200):**
```json
{
  "tenant_id": "DEFAULT",
  "total": 42,
  "page": 1,
  "per_page": 20,
  "results": [
    {
      "id": 7,
      "transaction_id": "e24562287a264651b0c42a3de9ea44fe",
      "status": "NALT",
      "evaluation_id": "019...",
      "evaluated_at": "2026-02-11T14:05:00.000Z",
      "processing_time_ns": "123456789",
      "typology_results": [{"id": "typology-processor@1.0.0", "result": 0, "...": "..."}]
    }
  ]
}
```

#### `GET /api/v1/results/{msg_id}` — Single evaluation

```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:8100/api/v1/results/e24562287a264651b0c42a3de9ea44fe"
```

Returns the full evaluation JSONB including the alert report, TADP result, all typology scores, and all rule results.

#### `GET /api/v1/results/stats/summary` — Statistics

```bash
curl -H "X-API-Key: your-key" \
  "http://localhost:8100/api/v1/results/stats/summary?tenant_id=DEFAULT"
```

**Response:**
```json
{
  "tenant_id": "DEFAULT",
  "evaluations_total": 42,
  "alerts": 3,
  "no_alerts": 39,
  "event_history_transactions": 156
}
```

### 6.4 Utility Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | ❌ | Health check with DB connectivity status |
| GET | `/` | ❌ | Dashboard UI |
| GET | `/docs` | ❌ | Swagger interactive docs |
| GET | `/redoc` | ❌ | ReDoc API docs |

---

## 7. Dashboard UI

The dashboard is a self-contained single-page application at `/` (or `/dashboard`).

### Features

| Feature | Description |
|---------|-------------|
| **Connect** | Enter your API key and tenant ID, click Connect |
| **Stats cards** | Total evaluations, alerts, no-alerts, event history tx count |
| **Results table** | Paginated list with status badges, filtering by ALRT/NALT |
| **Detail view** | Click "View" on any row to see full JSON evaluation |
| **Submit tab** | Submit test transactions directly from the UI |
| **Lookup tab** | Look up a specific evaluation by MsgId |

### Usage

1. Open `http://<your-host>:8100` in a browser
2. Enter your API key in the top bar
3. Set the Tenant ID (default: `DEFAULT`)
4. Click **Connect**
5. Stats populate and results load automatically

---

## 8. Security — API Keys

### How it works

- Every protected endpoint requires the `X-API-Key` header
- Keys are stored as a comma-separated list in the `API_KEYS` environment variable
- Comparison uses `secrets.compare_digest()` (constant-time) to prevent timing attacks
- Invalid keys return `403`; missing keys return `401`

### Generating keys

```bash
# Generate a single key:
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Generate 3 keys (for different clients):
python -c "import secrets; print(','.join(secrets.token_urlsafe(32) for _ in range(3)))"
```

### Multiple keys

Set multiple comma-separated keys to give different clients different keys:

```
API_KEYS=key-for-admin,key-for-monitoring,key-for-ci
```

Any one of them is valid. Rotate by removing a key from the list and restarting.

### Production recommendations

- Use keys of at least 32 bytes (`token_urlsafe(32)` = 43 characters)
- Rotate keys periodically
- Store keys in Kubernetes Secrets instead of plain env vars:

```bash
kubectl -n tazama create secret generic lipana-tps-keys \
  --from-literal=API_KEYS="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

Then reference in the deployment:
```yaml
env:
  - name: API_KEYS
    valueFrom:
      secretKeyRef:
        name: lipana-tps-keys
        key: API_KEYS
```

---

## 9. Docker Build & Run

### 9.1 Build the image

```bash
cd ~/Desktop/lipana-tps
docker build -t lipana-tps:latest .
```

### 9.2 Run locally with docker-compose

```bash
# Create .env first
cp .env.template .env
# Edit .env with your settings

docker-compose up -d
```

### 9.3 Run standalone

```bash
docker run -d \
  --name lipana-tps \
  -p 8100:8100 \
  --env-file .env \
  lipana-tps:latest
```

### 9.4 Verify

```bash
curl http://localhost:8100/health | jq .
```

---

## 10. Kubernetes Deployment (Your VPS)

This is your specific deployment path for the bare-metal VPS running Tazama.

### Step 1 — Transfer the project to your VPS

```bash
# From your local machine:
scp -r ~/Desktop/lipana-tps tom@<VPS_IP>:~/lipana-tps
```

### Step 2 — Build the Docker image on the VPS

```bash
ssh tom@<VPS_IP>
cd ~/lipana-tps
docker build -t lipana-tps:latest .
```

### Step 3 — Find your TMS service name

```bash
kubectl -n tazama get svc | grep -i gateway
```

Note the service name (e.g., `gateway`). Verify it matches `TMS_BASE_URL` in the k8s manifest.

If your TMS is called something else, find it:
```bash
kubectl -n tazama get svc
kubectl -n tazama get pods | grep tms
```

Update `TMS_BASE_URL` in `k8s-deployment.yaml` accordingly.

### Step 4 — Generate your API key

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the output and replace `CHANGE_ME_GENERATE_A_REAL_KEY` in `k8s-deployment.yaml`.

### Step 5 — Deploy

```bash
kubectl apply -f k8s-deployment.yaml
```

### Step 6 — Verify

```bash
# Check pod is running
kubectl -n tazama get pods -l app=lipana-tps

# Check logs
kubectl -n tazama logs deploy/lipana-tps

# Test health
curl http://127.0.0.1:30810/health | jq .
```

### Step 7 — Access from external

The service uses `NodePort: 30810`. Access from anywhere:

```
Dashboard:   http://<VPS_PUBLIC_IP>:30810/
API docs:    http://<VPS_PUBLIC_IP>:30810/docs
Health:      http://<VPS_PUBLIC_IP>:30810/health
```

> **Firewall**: Ensure port `30810` is open:
> ```bash
> sudo ufw allow 30810/tcp
> ```

### Step 8 — Test the full flow

```bash
# Generate a key if you haven't yet
API_KEY="your-generated-key"

# Submit a transaction
curl -X POST "http://<VPS_IP>:30810/api/v1/transactions/evaluate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "debtor_member": "dfsp001",
    "creditor_member": "dfsp002",
    "amount": 250.00,
    "currency": "USD",
    "status": "ACCC"
  }'

# Wait 2-3 seconds for pipeline processing, then check results
sleep 3

# List results
curl -H "X-API-Key: $API_KEY" "http://<VPS_IP>:30810/api/v1/results" | jq .

# Get stats
curl -H "X-API-Key: $API_KEY" "http://<VPS_IP>:30810/api/v1/results/stats/summary" | jq .
```

---

## 11. End-to-End Test Walkthrough

### Test 1: Successful transaction (expect NALT)

```bash
curl -X POST http://<HOST>:30810/api/v1/transactions/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "debtor_member": "dfsp001",
    "creditor_member": "dfsp002",
    "amount": 50.00,
    "currency": "USD",
    "status": "ACCC"
  }'
```

Expected: `"success": true`, returns a `msg_id`. After ~2s, query the result:

```bash
curl -H "X-API-Key: $API_KEY" \
  "http://<HOST>:30810/api/v1/results/<msg_id>"
```

Expected: `"status": "NALT"` (no alert — clean transaction with low history count).

### Test 2: Rejected transaction (expect exit condition .x00)

```bash
curl -X POST http://<HOST>:30810/api/v1/transactions/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "debtor_member": "dfsp001",
    "creditor_member": "dfsp002",
    "amount": 50.00,
    "currency": "USD",
    "status": "RJCT"
  }'
```

Expected: Transaction goes through but rule-901 hits the `.x00` exit condition (unsuccessful transaction).

### Test 3: Verify security (expect 401/403)

```bash
# Missing key → 401
curl -X POST http://<HOST>:30810/api/v1/transactions/evaluate \
  -H "Content-Type: application/json" \
  -d '{"debtor_member":"dfsp001","creditor_member":"dfsp002","amount":10,"currency":"USD","status":"ACCC"}'

# Wrong key → 403
curl -X POST http://<HOST>:30810/api/v1/transactions/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wrong-key" \
  -d '{"debtor_member":"dfsp001","creditor_member":"dfsp002","amount":10,"currency":"USD","status":"ACCC"}'
```

### Test 4: Dashboard

1. Open `http://<VPS_IP>:30810` in your browser
2. Enter your API key
3. Click Connect
4. Stats should show your evaluation totals
5. Go to the Submit tab and submit a transaction
6. Go back to Results tab and see it appear

---

## 12. Troubleshooting

### Lipana TPS can't reach TMS

```bash
# Check TMS service exists
kubectl -n tazama get svc | grep gateway

# Test from within the cluster
kubectl -n tazama exec deploy/lipana-tps -- \
  python -c "import urllib.request; print(urllib.request.urlopen('http://gateway.tazama.svc.cluster.local:3000/health').read())"
```

If the service name is different, update `TMS_BASE_URL` and restart:
```bash
kubectl -n tazama set env deploy/lipana-tps TMS_BASE_URL=http://correct-service:3000
```

### Database connection errors

```bash
# Check health endpoint
curl http://<HOST>:30810/health | jq .
```

The response shows connectivity for each database:
```json
{
  "status": "ok",
  "service": "lipana-tps",
  "databases": {
    "evaluation": "ok",
    "configuration": "ok",
    "event_history": "ok"
  }
}
```

If any shows an error, verify the DB env vars match your PostgreSQL setup.

### Results don't appear after submission

The Tazama pipeline is asynchronous (NATS messaging). After TMS accepts the transaction:
1. Event director routes to rules (~100ms)
2. Rules evaluate and publish to typology-processor (~200ms)
3. Typology-processor scores and publishes to TADProc (~200ms)
4. TADProc saves to evaluation database (~100ms)

Total: ~1-3 seconds. Wait before querying results.

```bash
# Check each processor's logs
kubectl -n tazama logs deploy/event-director --tail=5
kubectl -n tazama logs deploy/rule-901-processor --tail=5
kubectl -n tazama logs deploy/typology-processor --tail=5
kubectl -n tazama logs deploy/channel-router --tail=5
```

### Pod CrashLoopBackOff

```bash
kubectl -n tazama describe pod -l app=lipana-tps
kubectl -n tazama logs deploy/lipana-tps --previous
```

Common causes:
- Invalid `API_KEYS` format
- PostgreSQL not reachable (check host/port)
- Port 8100 already in use

### Rebuild and redeploy

```bash
cd ~/lipana-tps
docker build -t lipana-tps:latest .
kubectl -n tazama rollout restart deploy/lipana-tps
```

---

## License

Apache-2.0
