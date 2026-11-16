param(
  [string]$Ns = "biblio-prod",
  [Parameter(Mandatory = $true)][string]$BaseUrl
)
$log = Join-Path $env:TEMP "resilience-$(Get-Random).log"
New-Item -ItemType File -Path $log -Force | Out-Null

# Sonde : une requete toutes les 0,2 s, code HTTP note dans le journal
$probe = Start-Job -ArgumentList $BaseUrl, $log -ScriptBlock {
  param($u, $f)
  while ($true) {
    $c = curl.exe -s -m 5 -o NUL -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{}" "$u/api/auth/login"
    Add-Content -Path $f -Value "$(Get-Date -Format HH:mm:ss) $c"
    Start-Sleep -Milliseconds 200
  }
}

function Summary {
  $lines = @(Get-Content $log)
  # 400 = API joignable et validation active ; 429 = limitation anti brute force (normal)
  $ko = @($lines | Where-Object { $_ -notmatch ' (400|429)$' })
  Write-Host "  -> $($lines.Count) requetes envoyees, $($ko.Count) en erreur (attendu : 0)" -ForegroundColor Yellow
  if ($ko.Count) { $ko | Select-Object -First 5 | ForEach-Object { Write-Host "     $_" } }
  Clear-Content $log
}

function Count-Data {
  $q = "SELECT (SELECT count(*) FROM books) || ' livres, ' || (SELECT count(*) FROM users) || ' utilisateurs, ' || (SELECT count(*) FROM loans) || ' emprunts'"
  (kubectl exec -n $Ns postgres-0 -- psql -U biblio -d biblio -tAc $q).Trim()
}

try {
  Start-Sleep -Seconds 3
  Write-Host "== 1. Suppression d'un pod backend" -ForegroundColor Cyan
  kubectl get pods -n $Ns -l app=backend
  $pod = kubectl get pods -n $Ns -l app=backend -o jsonpath="{.items[0].metadata.name}"
  kubectl delete pod -n $Ns $pod --wait=false
  Start-Sleep -Seconds 20
  kubectl get pods -n $Ns -l app=backend
  Summary

  Write-Host "== 2. Rolling update (redemarrage progressif de tous les pods backend)" -ForegroundColor Cyan
  kubectl rollout restart -n $Ns deploy/backend
  kubectl rollout status -n $Ns deploy/backend --timeout=180s
  Summary

  Write-Host "== 3. Suppression du pod PostgreSQL (les donnees doivent survivre)" -ForegroundColor Cyan
  $before = Count-Data
  kubectl delete pod -n $Ns postgres-0
  kubectl wait -n $Ns --for=condition=Ready pod/postgres-0 --timeout=180s
  Start-Sleep -Seconds 5
  $after = Count-Data
  Write-Host "  -> avant : $before" -ForegroundColor Yellow
  Write-Host "  -> apres : $after  (doivent etre identiques)" -ForegroundColor Yellow
  Write-Host "  (pendant le redemarrage de la base, /readyz retire les pods API du Service : erreurs 503 breves possibles)"
  Summary
}
finally {
  Stop-Job $probe -ErrorAction SilentlyContinue
  Remove-Job $probe -Force -ErrorAction SilentlyContinue
  Remove-Item $log -ErrorAction SilentlyContinue
}