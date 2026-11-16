#!/usr/bin/env bash
# Déploiement canary du backend en production (voir k8s/canary/backend-canary.yaml).
# Usage :
#   NS=biblio-prod ./scripts/canary.sh start   <registry>/biblio-backend:<tag> 10
#   NS=biblio-prod ./scripts/canary.sh promote <registry>/biblio-backend:<tag>
#   NS=biblio-prod ./scripts/canary.sh abort
set -euo pipefail
NS="${NS:-biblio-prod}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="$(grep '^HOST=' "$ROOT/k8s/overlays/prod/azure-settings.env" | cut -d= -f2)"

case "${1:-}" in
  start)
    IMAGE="$2"; WEIGHT="${3:-10}"
    sed -e "s#__IMAGE__#${IMAGE}#" -e "s#__HOST__#${HOST}#" -e "s#__WEIGHT__#${WEIGHT}#" \
      "$ROOT/k8s/canary/backend-canary.yaml" | kubectl apply -n "$NS" -f -
    kubectl rollout status -n "$NS" deploy/backend-canary --timeout=180s
    echo "Canary actif : ${WEIGHT}% du trafic /api -> ${IMAGE}"
    echo "Surveillez le dashboard Grafana (taux d'erreur / latence), puis promote ou abort."
    ;;
  promote)
    IMAGE="$2"
    kubectl set image -n "$NS" deploy/backend backend="$IMAGE" migrate="$IMAGE"
    kubectl rollout status -n "$NS" deploy/backend --timeout=300s
    kubectl delete -n "$NS" ingress/biblio-canary svc/backend-canary deploy/backend-canary --ignore-not-found
    echo "Version promue en stable : ${IMAGE}"
    ;;
  abort)
    kubectl delete -n "$NS" ingress/biblio-canary svc/backend-canary deploy/backend-canary --ignore-not-found
    echo "Canary supprimé, 100 % du trafic sur la version stable."
    ;;
  *)
    echo "Usage : $0 start <image> [poids] | promote <image> | abort" >&2
    exit 1
    ;;
esac
