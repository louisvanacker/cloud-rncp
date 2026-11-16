#!/usr/bin/env bash
# Crée le stockage de l'état Terraform (à lancer UNE fois, avant terraform init).
set -euo pipefail
LOCATION="${1:-francecentral}"
RG=rg-biblio-tfstate
SA="sttfstate$(tr -dc a-z0-9 </dev/urandom | head -c 6)"
ME="$(az ad signed-in-user show --query id -o tsv)"

az group create -n "$RG" -l "$LOCATION" -o none
az storage account create -n "$SA" -g "$RG" -l "$LOCATION" --sku Standard_LRS \
  --min-tls-version TLS1_2 --allow-blob-public-access false --allow-shared-key-access false -o none
az storage account blob-service-properties update -n "$SA" -g "$RG" --enable-versioning true -o none
az role assignment create --assignee "$ME" --role "Storage Blob Data Owner" \
  --scope "$(az storage account show -n "$SA" -g "$RG" --query id -o tsv)" -o none
sleep 30
az storage container create -n tfstate --account-name "$SA" --auth-mode login -o none
echo "OK. Dans infra/terraform/versions.tf, décommentez le bloc backend avec storage_account_name = \"$SA\""
