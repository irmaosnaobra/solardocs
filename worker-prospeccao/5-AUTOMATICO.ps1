# ─────────────────────────────────────────────────────────────────────────────
#  MODO AUTOMATICO — trabalha sozinho das 07:00 as 23:59, sem comando nenhum.
#
#  Alterna: le quem respondeu -> aborda um novo -> espera -> repete.
#  Dorme fora da janela e acorda sozinho no dia seguinte.
#
#  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar a qualquer hora.
# ─────────────────────────────────────────────────────────────────────────────
# ── console em UTF-8 ─────────────────────────────────────────────────────────
# Sem isto o console usa a pagina de codigo antiga e a saida do Node vira
# "ÔòöÔòÉ" no lugar dos acentos e das molduras.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch { }

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot 'AUTOMATICO.log'
try { Stop-Transcript | Out-Null } catch { }
try { Start-Transcript -Path $log -Force -Append | Out-Null } catch { }

try { Invoke-RestMethod 'http://127.0.0.1:9222/json/version' -TimeoutSec 3 | Out-Null }
catch {
  Write-Host ''
  Write-Host '  O Chrome da agente nao esta aberto.' -ForegroundColor Red
  Write-Host '  Rode primeiro:  .\1-ABRIR-CHROME.ps1' -ForegroundColor Yellow
  Write-Host ''
  try { Stop-Transcript | Out-Null } catch { }
  Write-Host '  --- Aperte Enter para fechar ---' -ForegroundColor Yellow
  [void](Read-Host); exit 1
}

$env:CONSULTOR = if ($env:CONSULTOR) { $env:CONSULTOR } else { 'irmaosnaobra__' }
$env:NOME      = if ($env:NOME)      { $env:NOME }      else { 'Thiago' }

$ensaio = $args -notcontains '--valendo'

Write-Host ''
if ($ensaio) {
  Write-Host '  AUTOMATICO — ENSAIO (nao envia nada)' -ForegroundColor Cyan
  Write-Host '  Pra valer:  .\5-AUTOMATICO.ps1 --valendo' -ForegroundColor DarkGray
} else {
  Write-Host '  AUTOMATICO — VALENDO' -ForegroundColor Green
}
Write-Host '  ---------------------------------------------------------------'
Write-Host "  Conta:   $env:CONSULTOR  (assina como $env:NOME)"
Write-Host '  Janela:  07:00 as 23:59'
Write-Host '  Radar:   https://solardoc.app/gerador/radar/' -ForegroundColor Cyan
Write-Host ''
Write-Host '  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar.' -ForegroundColor Yellow
Write-Host ''

if ($ensaio) { node worker.mjs --dry --modo=continuo --canal=instagram }
else         { node worker.mjs --modo=continuo --canal=instagram }

Write-Host ''
Write-Host '  O modo automatico parou.' -ForegroundColor Yellow
try { Stop-Transcript | Out-Null } catch { }
Write-Host '  --- Aperte Enter para fechar ---' -ForegroundColor Yellow
[void](Read-Host)
