# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 3 — VALENDO. A agente aborda de verdade, dentro do teto do dia.
#  Acompanhe em: https://solardoc.app/gerador/radar/
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

$env:CONSULTOR = if ($env:CONSULTOR) { $env:CONSULTOR } else { 'irmaosnaobra__' }
# Quem assina a mensagem. A conta gasta o teto; a pessoa assina o texto.
$env:NOME      = if ($env:NOME)      { $env:NOME }      else { 'Thiago' }

Write-Host ''
Write-Host '  VALENDO' -ForegroundColor Green
Write-Host '  ---------------------------------------------------------------'
Write-Host "  Conta:   $env:CONSULTOR"
Write-Host '  Radar:   https://solardoc.app/gerador/radar/' -ForegroundColor Cyan
Write-Host ''
Write-Host '  O teto do dia e do banco, nao daqui. Ctrl+C para a qualquer hora.' -ForegroundColor DarkGray
Write-Host ''

node worker.mjs --canal=instagram

Write-Host ''
Write-Host '  Terminou a rodada de abordagem.' -ForegroundColor Green
Write-Host '  Mais tarde, pra responder quem respondeu:  .\4-RESPONDER.ps1' -ForegroundColor Cyan
Write-Host ''
