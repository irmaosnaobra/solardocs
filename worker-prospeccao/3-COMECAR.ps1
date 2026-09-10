# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 3 — VALENDO. A agente aborda de verdade, dentro do teto do dia.
#  Acompanhe em: https://solardoc.app/gerador/radar/
# ─────────────────────────────────────────────────────────────────────────────
# ── nao deixe a janela sumir ─────────────────────────────────────────────────
# Executar-com-PowerShell fecha a janela no fim, e o erro vai junto. Transcript
# grava tudo num arquivo; o finally segura a janela ate alguem apertar Enter.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot 'ULTIMA-EXECUCAO.log'
try { Stop-Transcript | Out-Null } catch { }
try { Start-Transcript -Path $log -Force | Out-Null } catch { }

function Fim {
  param([string]$proximo)
  Write-Host ''
  if ($proximo) { Write-Host "  Proximo passo:  $proximo" -ForegroundColor Cyan }
  Write-Host "  Tudo isso ficou salvo em: ULTIMA-EXECUCAO.log" -ForegroundColor DarkGray
  Write-Host ''
  try { Stop-Transcript | Out-Null } catch { }
  Write-Host '  --- Aperte Enter para fechar ---' -ForegroundColor Yellow
  [void](Read-Host)
}


try { Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 3 | Out-Null }
catch {
  Write-Host ''
  Write-Host '  O Chrome da agente nao esta aberto.' -ForegroundColor Red
  Write-Host '  Rode primeiro:  .\1-ABRIR-CHROME.ps1' -ForegroundColor Yellow
  Write-Host ''
  Fim; exit 1
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

Fim '.\\4-RESPONDER.ps1  (mais tarde, pra ler quem respondeu)'
