#!/usr/bin/env bash
# Démonstration de résilience (à capturer pour le rapport) :
#  1) suppression brutale d'un pod backend pendant que des requêtes tournent -> aucune erreur visible
#  2) rolling update forcé -> zéro interruption
#  3) suppression du pod PostgreSQL -> recréé avec ses données (PersistentVolume)
# Usage : NS=biblio-dev BASE_URL=https://dev.biblio.<IP>.nip.io ./scripts/resilience-test.sh
set -uo pipefail
NS="${NS:-biblio}"
BASE_URL="${BASE_URL:-http://biblio.localtest.me}"
LOG="$(mktemp)"

probe() { # envoie une requête toutes les 0,2 s et note le code HTTP
  while true; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE_URL/api/auth/login")
    echo "$(date +%T) $code" >> "$LOG"
    sleep 0.2
  done
}

summary() {
  total=$(wc -l < "$LOG"); ko=$(grep -cvE ' (400|429)$' "$LOG")
  echo "  -> $total requêtes envoyées, $ko en erreur (attendu : 0)"
  : > "$LOG"
}

probe & PROBE=$!
trap 'kill $PROBE 2>/dev/null; rm -f "$LOG"' EXIT

echo "== 1. Suppression d'un pod backend"
kubectl get pods -n "$NS" -l app=backend
POD=$(kubectl get pods -n "$NS" -l app=backend -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod -n "$NS" "$POD" --wait=false
sleep 20
kubectl get pods -n "$NS" -l app=backend
summary

echo "== 2. Rolling update (redémarrage progressif de tous les pods backend)"
kubectl rollout restart -n "$NS" deploy/backend
kubectl rollout status -n "$NS" deploy/backend --timeout=180s
summary

echo "== 3. Suppression du pod PostgreSQL (les données doivent survivre)"
BEFORE=$(kubectl exec -n "$NS" postgres-0 -- psql -U biblio -d biblio -tAc 'SELECT count(*) FROM loans')
kubectl delete pod -n "$NS" postgres-0
kubectl wait -n "$NS" --for=condition=Ready pod/postgres-0 --timeout=180s
AFTER=$(kubectl exec -n "$NS" postgres-0 -- psql -U biblio -d biblio -tAc 'SELECT count(*) FROM loans')
echo "  -> emprunts avant : $BEFORE / après : $AFTER (doivent être égaux)"
echo "  (pendant l'indisponibilité de la base, /readyz retire les pods API du Service : erreurs 503 brèves possibles)"
summary
