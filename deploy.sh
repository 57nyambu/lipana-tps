#!/usr/bin/env bash
# ============================================================
# Lipana TPS — Production Deployment Script
# Target: tazama.lipana.co
# ============================================================
set -euo pipefail

# ── Configuration ────────────────────────────────────────────
APP_NAME="lipana-tps"
APP_VERSION="${APP_VERSION:-1.0.0}"
DOCKER_IMAGE="${DOCKER_IMAGE:-lipana-tps}"
DOCKER_TAG="${DOCKER_TAG:-latest}"
K8S_NAMESPACE="${K8S_NAMESPACE:-tazama}"
K8S_MANIFEST="${K8S_MANIFEST:-k8s-deployment.yaml}"
DOMAIN="tazama.lipana.co"
HEALTH_URL="http://localhost:8100/health"
MAX_WAIT=120
LOG_FILE="deploy_$(date +%Y%m%d_%H%M%S).log"

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── Helpers ──────────────────────────────────────────────────
log()     { echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"; }
success() { echo -e "${GREEN}[$(date +'%H:%M:%S')] ✓${NC} $*" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[$(date +'%H:%M:%S')] ⚠${NC} $*" | tee -a "$LOG_FILE"; }
error()   { echo -e "${RED}[$(date +'%H:%M:%S')] ✗${NC} $*" | tee -a "$LOG_FILE"; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n" | tee -a "$LOG_FILE"; }

die() {
    error "$*"
    echo -e "${RED}Deployment failed. Check ${LOG_FILE} for details.${NC}"
    exit 1
}

# ── Pre-flight Checks ───────────────────────────────────────
preflight() {
    header "Pre-flight Checks"

    # Docker
    if command -v docker &>/dev/null; then
        success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
    else
        die "Docker is not installed"
    fi

    # kubectl (optional — skip if Docker-only deploy)
    if command -v kubectl &>/dev/null; then
        success "kubectl $(kubectl version --client -o json 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['clientVersion']['gitVersion'])" 2>/dev/null || echo 'available')"
        HAS_KUBECTL=true
    else
        warn "kubectl not found — skipping Kubernetes deployment"
        HAS_KUBECTL=false
    fi

    # Check files exist
    for f in Dockerfile requirements.txt "$K8S_MANIFEST"; do
        if [[ -f "$f" ]]; then
            success "Found $f"
        else
            warn "Missing $f"
        fi
    done

    # Check .env
    if [[ -f .env ]]; then
        success "Found .env configuration"
    else
        warn "No .env file found — using default configuration"
    fi
}

# ── Build Docker Image ──────────────────────────────────────
build_image() {
    header "Building Docker Image"
    log "Image: ${DOCKER_IMAGE}:${DOCKER_TAG}"

    docker build \
        --tag "${DOCKER_IMAGE}:${DOCKER_TAG}" \
        --tag "${DOCKER_IMAGE}:${APP_VERSION}" \
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        --build-arg VERSION="${APP_VERSION}" \
        . 2>&1 | tee -a "$LOG_FILE"

    if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
        success "Docker image built: ${DOCKER_IMAGE}:${DOCKER_TAG}"
    else
        die "Docker build failed"
    fi
}

# ── Deploy with Docker Compose ───────────────────────────────
deploy_compose() {
    header "Deploying with Docker Compose"

    if [[ -f docker-compose.yml ]]; then
        docker compose down --remove-orphans 2>/dev/null || true
        docker compose up -d 2>&1 | tee -a "$LOG_FILE"
        success "Docker Compose deployed"
    else
        die "docker-compose.yml not found"
    fi
}

# ── Deploy to Kubernetes ─────────────────────────────────────
deploy_k8s() {
    header "Deploying to Kubernetes"

    if [[ "$HAS_KUBECTL" != "true" ]]; then
        warn "kubectl not available — skipping K8s deployment"
        return 0
    fi

    if [[ ! -f "$K8S_MANIFEST" ]]; then
        die "Kubernetes manifest not found: $K8S_MANIFEST"
    fi

    # Ensure namespace exists
    kubectl get namespace "$K8S_NAMESPACE" &>/dev/null 2>&1 || {
        log "Creating namespace: $K8S_NAMESPACE"
        kubectl create namespace "$K8S_NAMESPACE"
    }

    # Apply manifests
    log "Applying Kubernetes manifests..."
    kubectl apply -f "$K8S_MANIFEST" 2>&1 | tee -a "$LOG_FILE"

    # Wait for rollout
    log "Waiting for deployment rollout..."
    if kubectl rollout status deployment/"$APP_NAME" \
        -n "$K8S_NAMESPACE" \
        --timeout="${MAX_WAIT}s" 2>&1 | tee -a "$LOG_FILE"; then
        success "Kubernetes deployment rolled out successfully"
    else
        error "Rollout timed out — initiating rollback"
        kubectl rollout undo deployment/"$APP_NAME" -n "$K8S_NAMESPACE" 2>&1 | tee -a "$LOG_FILE"
        die "Deployment rolled back due to timeout"
    fi

    # Show status
    log "Pod status:"
    kubectl get pods -n "$K8S_NAMESPACE" -l app="$APP_NAME" -o wide 2>&1 | tee -a "$LOG_FILE"
}

# ── Setup Nginx Reverse Proxy ────────────────────────────────
setup_nginx() {
    header "Configuring Nginx for ${DOMAIN}"

    local NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
    local NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

    if ! command -v nginx &>/dev/null; then
        warn "Nginx not installed — skipping reverse proxy setup"
        return 0
    fi

    cat > /tmp/lipana-nginx.conf <<EOF
# Lipana TPS — Nginx reverse proxy
# Generated by deploy.sh on $(date)

server {
    listen 80;
    server_name ${DOMAIN};

    # Redirect HTTP to HTTPS
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    # SSL certificates (managed by Certbot or similar)
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 256;

    # Proxy to Lipana TPS
    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket support (if needed)
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Static files caching
    location /static/ {
        proxy_pass http://127.0.0.1:8100/static/;
        proxy_cache_valid 200 1d;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }

    # Health check (no logging)
    location /health {
        proxy_pass http://127.0.0.1:8100/health;
        access_log off;
    }
}
EOF

    if [[ $EUID -eq 0 ]]; then
        cp /tmp/lipana-nginx.conf "$NGINX_CONF"
        ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
        nginx -t 2>&1 | tee -a "$LOG_FILE" && {
            systemctl reload nginx
            success "Nginx configured for ${DOMAIN}"
        } || {
            error "Nginx configuration test failed"
        }
    else
        warn "Not root — Nginx config written to /tmp/lipana-nginx.conf"
        warn "Run as root or manually copy to ${NGINX_CONF}"
    fi
}

# ── Setup SSL with Certbot ───────────────────────────────────
setup_ssl() {
    header "SSL Certificate Setup"

    if ! command -v certbot &>/dev/null; then
        warn "Certbot not installed. Install with:"
        warn "  apt install certbot python3-certbot-nginx"
        warn "  certbot --nginx -d ${DOMAIN}"
        return 0
    fi

    if [[ $EUID -ne 0 ]]; then
        warn "Not root — run certbot manually:"
        warn "  sudo certbot --nginx -d ${DOMAIN}"
        return 0
    fi

    log "Requesting SSL certificate for ${DOMAIN}..."
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect 2>&1 | tee -a "$LOG_FILE" || {
        warn "Certbot failed — you may need to run it manually"
    }
}

# ── Health Check ─────────────────────────────────────────────
health_check() {
    header "Health Check"

    local attempts=0
    local max_attempts=$((MAX_WAIT / 5))

    log "Waiting for service to become healthy..."

    while [[ $attempts -lt $max_attempts ]]; do
        if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
            success "Service is healthy!"
            curl -s "$HEALTH_URL" | python3 -m json.tool 2>/dev/null | tee -a "$LOG_FILE" || \
                curl -s "$HEALTH_URL" | tee -a "$LOG_FILE"
            return 0
        fi
        attempts=$((attempts + 1))
        log "Attempt $attempts/$max_attempts — waiting 5s..."
        sleep 5
    done

    warn "Health check timed out after ${MAX_WAIT}s"
    return 1
}

# ── Summary ──────────────────────────────────────────────────
summary() {
    header "Deployment Summary"

    echo -e "${BOLD}Service:${NC}     ${APP_NAME} v${APP_VERSION}"
    echo -e "${BOLD}Domain:${NC}      https://${DOMAIN}"
    echo -e "${BOLD}Dashboard:${NC}   https://${DOMAIN}/dashboard"
    echo -e "${BOLD}Login:${NC}       https://${DOMAIN}/"
    echo -e "${BOLD}API Docs:${NC}    https://${DOMAIN}/docs"
    echo -e "${BOLD}ReDoc:${NC}       https://${DOMAIN}/redoc"
    echo -e "${BOLD}Health:${NC}      https://${DOMAIN}/health"
    echo -e "${BOLD}Log File:${NC}    ${LOG_FILE}"
    echo ""
    success "Deployment complete! 🚀"
}

# ── Main ─────────────────────────────────────────────────────
main() {
    header "Lipana TPS — Deployment"
    echo -e "${CYAN}Target: ${BOLD}${DOMAIN}${NC}"
    echo -e "${CYAN}Version: ${BOLD}${APP_VERSION}${NC}"
    echo ""

    local MODE="${1:-full}"

    case "$MODE" in
        build)
            preflight
            build_image
            ;;
        compose)
            preflight
            build_image
            deploy_compose
            health_check
            summary
            ;;
        k8s|kubernetes)
            preflight
            build_image
            deploy_k8s
            health_check
            summary
            ;;
        nginx)
            setup_nginx
            setup_ssl
            ;;
        health)
            health_check
            ;;
        full)
            preflight
            build_image
            deploy_compose
            setup_nginx
            health_check
            summary
            ;;
        *)
            echo "Usage: $0 {full|build|compose|k8s|nginx|health}"
            echo ""
            echo "Modes:"
            echo "  full      — Build, deploy (Compose), configure Nginx, health check"
            echo "  build     — Build Docker image only"
            echo "  compose   — Build and deploy with Docker Compose"
            echo "  k8s       — Build and deploy to Kubernetes"
            echo "  nginx     — Configure Nginx reverse proxy + SSL"
            echo "  health    — Run health check only"
            exit 1
            ;;
    esac
}

main "$@"
