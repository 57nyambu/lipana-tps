# Lipana TPS — Guide

> Transaction Processing Service for the Tazama fraud-detection pipeline.

---

## Quick Deploy (VPS with Kubernetes)

```bash
# 1. Copy project to VPS
scp -r lipana-tps user@VPS_IP:~/

# 2. SSH in and deploy
ssh user@VPS_IP
cd ~/lipana-tps

# 3. Generate an API key and edit the config
./deploy.sh key                       # prints a new key
vi k8s-deployment.yaml                # paste key into API_KEYS field

# 4. Build + deploy
./deploy.sh
```

That's it. Dashboard: `http://VPS_IP:30810`, API docs: `http://VPS_IP:30810/docs`

> Open the firewall if needed: `sudo ufw allow 30810/tcp`

---

## Deploy Script Commands

| Command | What it does |
|---------|--------------|
| `./deploy.sh` | Build image + apply to K8s + verify (default) |
| `./deploy.sh build` | Build Docker image only |
| `./deploy.sh apply` | Apply K8s manifests only (skip build) |
| `./deploy.sh logs` | Tail pod logs |
| `./deploy.sh status` | Show pod status + health check |
| `./deploy.sh restart` | Rolling restart |
| `./deploy.sh key` | Generate a new API key |

---

## Local Development

```bash
cd lipana-tps

# Create a virtual env
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/Mac

pip install -r requirements.txt

# Configure
cp .env.template .env
# Edit .env — for local dev, forward the cluster services:
#   kubectl -n tazama port-forward svc/gateway 3000:3000
#   kubectl -n tazama port-forward svc/postgres 5432:5432
# then set TMS_BASE_URL=http://127.0.0.1:3000 and *_DB_HOST=127.0.0.1

# Generate and set your API key
python -c "import secrets; print(secrets.token_urlsafe(32))"
# paste into .env as API_KEYS=your-key-here

# Run
python -m app
```

Open http://localhost:8100

---

## Configuration

All values via environment variables or `.env` file. Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEYS` | `change-me…` | Comma-separated API keys |
| `TMS_BASE_URL` | `http://gateway.tazama.svc.cluster.local:3000` | Tazama TMS URL |
| `EVAL_DB_HOST` | `postgres.tazama.svc.cluster.local` | PostgreSQL host |
| `EVAL_DB_NAME` | `evaluation` | Evaluation DB |
| `CONFIG_DB_NAME` | `configuration` | Configuration DB |
| `EVENT_DB_NAME` | `event_history` | Event history DB |
| `DEFAULT_TENANT_ID` | `DEFAULT` | Fallback tenant |

Full list in [.env.template](.env.template).

---

## API

All endpoints (except `/health` and `/`) need the `X-API-Key` header.

### Submit a transaction

```bash
curl -X POST http://HOST:30810/api/v1/transactions/evaluate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "debtor_member": "dfsp001",
    "creditor_member": "dfsp002",
    "amount": 100.00,
    "currency": "USD",
    "status": "ACCC"
  }'
```

### Get results

```bash
curl -H "X-API-Key: YOUR_KEY" "http://HOST:30810/api/v1/results?page=1&per_page=20"
```

### Get stats

```bash
curl -H "X-API-Key: YOUR_KEY" "http://HOST:30810/api/v1/results/stats/summary"
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/transactions/evaluate` | Submit transaction (simplified) |
| POST | `/api/v1/transactions/evaluate/raw` | Submit raw pacs.002 |
| GET | `/api/v1/results` | List evaluations (paginated) |
| GET | `/api/v1/results/{msg_id}` | Single evaluation detail |
| GET | `/api/v1/results/stats/summary` | Aggregate statistics |
| GET | `/health` | Health check (no auth) |
| GET | `/` | Login page |
| GET | `/dashboard` | Dashboard SPA |
| GET | `/docs` | Swagger docs |

---

## Dashboard

The dashboard at `/` has these pages:

- **Overview** — Stats, chart, pipeline health, recent evaluations
- **Pipeline Flow** — Visual diagram of processing pipeline with pod health
- **Results** — Paginated evaluation table with status filtering
- **Alerts** — Alert investigation with summary cards
- **Submit Transaction** — Send test transactions
- **Lookup** — Find evaluation by message ID
- **Pods & Services** — Kubernetes pod management (view, restart, logs)
- **NATS Cluster** — NATS messaging pod status
- **Logs** — Container log viewer
- **Deployments** — Scale and restart deployments
- **Events** — Cluster event feed
- **Settings** — Connection info, DB status, auto-refresh

---

## Troubleshooting

```bash
# Check pod status
./deploy.sh status

# Check logs
./deploy.sh logs

# Restart
./deploy.sh restart

# Rebuild after code changes
./deploy.sh

# Test health
curl http://127.0.0.1:30810/health | python3 -m json.tool

# Check TMS connectivity from inside the pod
kubectl -n tazama exec deploy/lipana-tps -- \
  python -c "import urllib.request; print(urllib.request.urlopen('http://gateway.tazama.svc.cluster.local:3000/health').read())"

# Check DB connectivity (shown in health response)
# "databases": { "evaluation": "ok", "configuration": "ok", "event_history": "ok" }
```

---

## Project Structure

```
lipana-tps/
├── app/
│   ├── main.py           # FastAPI app
│   ├── config.py          # Env-based settings
│   ├── auth.py            # API key auth
│   ├── database.py        # PostgreSQL queries
│   ├── models.py          # Request/response models
│   ├── routes/
│   │   ├── entry.py       # POST — submit transactions
│   │   ├── exit.py        # GET  — retrieve results
│   │   ├── system.py      # K8s cluster management
│   │   └── dashboard.py   # Serve HTML pages
│   ├── templates/         # HTML (login, dashboard)
│   └── static/            # CSS, JS
├── deploy.sh              # Deploy script
├── k8s-deployment.yaml    # K8s Deployment + ConfigMap + Service
├── Dockerfile
├── docker-compose.yml     # Local dev
├── requirements.txt
├── .env.template
└── GUIDE.md               # ← This file
```
