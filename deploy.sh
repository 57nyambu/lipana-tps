#!/usr/bin/env bash
# Lipana TPS — Deploy to Kubernetes
# Usage: ./deploy.sh [build|apply|logs|status|restart|key]
set -euo pipefail

NS="tazama"
APP="lipana-tps"
IMG="lipana-tps:latest"

case "${1:-deploy}" in
  build)
    echo "▸ Building Docker image..."
    docker build -t "$IMG" .
    echo "✓ Image built: $IMG"
    ;;

  apply)
    echo "▸ Applying K8s manifests..."
    kubectl apply -f k8s-deployment.yaml
    kubectl -n "$NS" rollout status deploy/"$APP" --timeout=90s
    echo "✓ Deployed"
    kubectl -n "$NS" get pods -l app="$APP" -o wide
    ;;

  deploy)
    echo "▸ Building image..."
    docker build -t "$IMG" .
    echo "▸ Applying to cluster..."
    kubectl apply -f k8s-deployment.yaml
    kubectl -n "$NS" rollout status deploy/"$APP" --timeout=90s
    echo ""
    echo "✓ Lipana TPS is live"
    echo "  Dashboard:  http://$(hostname -I | awk '{print $1}'):30810"
    echo "  API docs:   http://$(hostname -I | awk '{print $1}'):30810/docs"
    echo "  Health:     http://$(hostname -I | awk '{print $1}'):30810/health"
    ;;

  logs)
    kubectl -n "$NS" logs deploy/"$APP" -f --tail=100
    ;;

  status)
    kubectl -n "$NS" get pods -l app="$APP" -o wide
    echo ""
    curl -sf "http://127.0.0.1:30810/health" 2>/dev/null | python3 -m json.tool || echo "⚠ Health endpoint unreachable"
    ;;

  restart)
    kubectl -n "$NS" rollout restart deploy/"$APP"
    kubectl -n "$NS" rollout status deploy/"$APP" --timeout=90s
    echo "✓ Restarted"
    ;;

  key)
    python3 -c "import secrets; print(secrets.token_urlsafe(32))"
    ;;

  *)
    echo "Usage: ./deploy.sh [deploy|build|apply|logs|status|restart|key]"
    echo ""
    echo "  deploy   Build image + apply to K8s (default)"
    echo "  build    Build Docker image only"
    echo "  apply    Apply K8s manifests only (skip build)"
    echo "  logs     Tail pod logs"
    echo "  status   Show pod status + health check"
    echo "  restart  Rolling restart"
    echo "  key      Generate a new API key"
    ;;
esac
