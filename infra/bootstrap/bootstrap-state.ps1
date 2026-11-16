# Crée le stockage de l'état Terraform (à lancer UNE fois, avant terraform init).
# État distant = chiffré, versionné, verrouillé (pas de terraform.tfstate en local ou dans Git).
# Usage : .\infra\bootstrap\bootstrap-state.ps1 [-Location francecentral]
param([string]$Location = "francecentral")
$ErrorActionPreference = "Stop"

$rg = "rg-biblio-tfstate"
$suffix = -join ((97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$sa = "sttfstate$suffix"
$me = az ad signed-in-user show --query id -o tsv

az group create -n $rg -l $Location -o none
az storage account create -n $sa -g $rg -l $Location --sku Standard_LRS `
  --min-tls-version TLS1_2 --allow-blob-public-access false --allow-shared-key-access false -o none
az storage account blob-service-properties update -n $sa -g $rg --enable-versioning true -o none
$saId = az storage account show -n $sa -g $rg --query id -o tsv
az role assignment create --assignee $me --role "Storage Blob Data Owner" --scope $saId -o none
Start-Sleep -Seconds 30  # propagation du rôle
az storage container create -n tfstate --account-name $sa --auth-mode login -o none

Write-Host "OK. Dans infra/terraform/versions.tf, décommentez le bloc backend avec :"
Write-Host "  storage_account_name = `"$sa`""
