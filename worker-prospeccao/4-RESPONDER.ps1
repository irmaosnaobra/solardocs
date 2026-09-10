# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 4 — A agente le quem respondeu e responde sozinha.
#  Rode algumas vezes ao longo do dia. So gasta IA em conversa que teve resposta.
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
$modo = if ($args -contains '--valendo') { '' } else { '--dry' }

Write-Host ''
if ($modo) { Write-Host '  ENSAIO — le as conversas e mostra a resposta, sem mandar' -ForegroundColor Cyan }
else       { Write-Host '  RESPONDENDO DE VERDADE' -ForegroundColor Green }
Write-Host '  ---------------------------------------------------------------'
Write-Host ''

if ($modo) { node worker.mjs --dry --modo=responder --canal=instagram }
else       { node worker.mjs --modo=responder --canal=instagram }

Write-Host ''
if ($modo) { Write-Host '  Pra responder de verdade:  .\4-RESPONDER.ps1 --valendo' -ForegroundColor Cyan }
Write-Host ''
