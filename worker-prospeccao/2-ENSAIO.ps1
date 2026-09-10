# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 2 — ENSAIO. Mostra tudo que sairia, sem mandar mensagem pra ninguem.
#  Rode isto ANTES de valer. Leia dez mensagens e decida se o tom esta bom.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

try { Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 3 | Out-Null }
catch {
  Write-Host ''
  Write-Host '  O Chrome da agente nao esta aberto.' -ForegroundColor Red
  Write-Host '  Rode primeiro:  .\1-ABRIR-CHROME.ps1' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

Write-Host ''
Write-Host '  ENSAIO — nada sera enviado' -ForegroundColor Cyan
Write-Host '  ---------------------------------------------------------------'
Write-Host ''
$env:CONSULTOR = if ($env:CONSULTOR) { $env:CONSULTOR } else { 'IG Prospeccao' }
node worker.mjs --dry --canal=instagram

Write-Host ''
Write-Host '  Gostou do tom?  ->  .\3-COMECAR.ps1' -ForegroundColor Cyan
Write-Host '  Quer mudar?     ->  me diga o que trocar' -ForegroundColor DarkGray
Write-Host ''
