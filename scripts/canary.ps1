# Deploiement canary du backend (voir k8s/canary/backend-canary.yaml).
# Usage :
#   .\scripts\canary.ps1 start  -Image <acr>.azurecr.io/biblio-backend:<sha> -Weight 20
#   .\scripts\canary.ps1 test   (repartition observee sur /api/version)
#   .\scripts\canary.ps1 abort  (suppression du canary : 100 % sur la version stable)
# La promotion se fait ensuite par une release (tag vX.Y.Z -> pipeline -> approbation),
# pour que la prod reste identique au code du depot.
param(
  [Parameter(Mandatory = $true)][ValidateSet("start", "test", "abort")][string]$Action,
  [string]$Image,
  [int]$Weight = 20,
  [string]$Ns = "biblio-prod",
  [int]$Requests = 50
)
$root = Split-Path $PSScriptRoot -Parent
$hostLine = Get-Content (Join-Path $root "k8s/overlays/prod/azure-settings.env") | Where-Object { $_ -like "HOST=*" }
$hostName = $hostLine.Substring(5).Trim()

switch ($Action) {
  "start" {
    if (-not $Image) { throw "Indique l'image : -Image <acr>.azurecr.io/biblio-backend:<sha>" }
    $yaml = Get-Content (Join-Path $root "k8s/canary/backend-canary.yaml") -Raw
    $yaml = $yaml.Replace("__IMAGE__", $Image).Replace("__HOST__", $hostName).Replace("__WEIGHT__", "$Weight")
    $tmp = Join-Path $env:TEMP "canary-rendered.yaml"
    [IO.File]::WriteAllText($tmp, $yaml, (New-Object Text.UTF8Encoding $false))
    kubectl apply -n $Ns -f $tmp
    kubectl rollout status -n $Ns deploy/backend-canary --timeout=180s
    Remove-Item $tmp
    Write-Host "Canary actif : $Weight % du trafic /api -> $Image" -ForegroundColor Green
    Write-Host "Verifie la repartition avec : .\scripts\canary.ps1 test"
  }
  "test" {
    # /api/version : 200 + numero de version sur la nouvelle version ; 401 sur l ancienne (route absente, donc derriere l authentification)
    $results = 1..$Requests | ForEach-Object {
      $r = curl.exe -s -w " %{http_code}" "https://$hostName/api/version"
      if ($r -match '"version":"([^"]+)"') { "nouvelle ($($Matches[1]))" } else { "stable (ancienne)" }
    }
    Write-Host "Repartition sur $Requests requetes vers https://$hostName/api/version :" -ForegroundColor Cyan
    $results | Group-Object | Sort-Object Count -Descending |
      Format-Table @{ n = "Version"; e = { $_.Name } }, @{ n = "Requetes"; e = { $_.Count } },
      @{ n = "Part"; e = { "{0:P0}" -f ($_.Count / $Requests) } } -AutoSize
  }
  "abort" {
    kubectl delete -n $Ns ingress/biblio-canary svc/backend-canary deploy/backend-canary --ignore-not-found
    Write-Host "Canary supprime : 100 % du trafic sur la version stable." -ForegroundColor Green
  }
}