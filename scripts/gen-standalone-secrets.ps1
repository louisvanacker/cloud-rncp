# Version PowerShell de gen-standalone-secrets.sh
# Usage : .\scripts\gen-standalone-secrets.ps1 [-AdminEmail admin@biblio.local]
param([string]$AdminEmail = "admin@biblio.local")
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\k8s\overlays\standalone"

function New-Secret([int]$bytes = 24) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([BitConverter]::ToString($b) -replace "-", "").ToLower()
}

$db = New-Secret; $redis = New-Secret
$adminPwd = (New-Secret 12)
@"
DB_PASSWORD=$db
REDIS_PASSWORD=$redis
JWT_SECRET=$(New-Secret 32)
S3_ACCESS_KEY=biblio-$(New-Secret 4)
S3_SECRET_KEY=$(New-Secret)
SEED_ADMIN_EMAIL=$AdminEmail
SEED_ADMIN_PASSWORD=$adminPwd
"@ | Set-Content -NoNewline -Encoding ascii (Join-Path $dir "secrets.env")
@"
DB_PASSWORD=$db
REDIS_PASSWORD=$redis
"@ | Set-Content -NoNewline -Encoding ascii (Join-Path $dir "data-secrets.env")

Write-Host "Secrets générés dans $dir (non commités)."
Write-Host "Compte admin : $AdminEmail / $adminPwd   <- notez-le"
