#!/usr/bin/env bash
# Génère les fichiers de secrets de l'overlay standalone (ignorés par Git).
# Usage : ./scripts/gen-standalone-secrets.sh [email-admin]
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/k8s/overlays/standalone"
rnd() { openssl rand -hex 24; }
DB="$(rnd)"; REDIS="$(rnd)"
ADMIN_PWD="$(openssl rand -base64 18 | tr -d '/+=')"
cat > "$DIR/secrets.env" <<EOF
DB_PASSWORD=$DB
REDIS_PASSWORD=$REDIS
JWT_SECRET=$(openssl rand -hex 32)
S3_ACCESS_KEY=biblio-$(openssl rand -hex 4)
S3_SECRET_KEY=$(rnd)
SEED_ADMIN_EMAIL=${1:-admin@biblio.local}
SEED_ADMIN_PASSWORD=$ADMIN_PWD
EOF
cat > "$DIR/data-secrets.env" <<EOF
DB_PASSWORD=$DB
REDIS_PASSWORD=$REDIS
EOF
chmod 600 "$DIR/secrets.env" "$DIR/data-secrets.env"
echo "Secrets générés dans $DIR (non commités)."
echo "Compte admin : ${1:-admin@biblio.local} / $ADMIN_PWD   <- notez-le"
