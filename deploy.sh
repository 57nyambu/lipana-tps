#!/usr/bin/env bash
set -euo pipefail

NS="tazama"
APP="lipana-tps"

case "${1:-deploy}" in
  deploy|apply)
    echo "▸ Applying K8s manifests..."
    kubectl apply -f k8s-deployment.yaml
    kubectl -n "$NS" rollout status deploy/"$APP" --timeout=90s
    echo "✓ Deployed"
    kubectl -n "$NS" get pods -l app="$APP" -o wide
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
    echo "Usage: ./deploy.sh [deploy|apply|logs|status|restart|key]"
    ;;
esac