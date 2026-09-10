# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 2 — ENSAIO. Mostra tudo que sairia, sem mandar mensagem pra ninguem.
#  Rode isto ANTES de valer. Leia dez mensagens e decida se o tom esta bom.
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

Write-Host ''
Write-Host '  ENSAIO — nada sera enviado' -ForegroundColor Cyan
Write-Host '  ---------------------------------------------------------------'
Write-Host ''
$env:CONSULTOR = if ($env:CONSULTOR) { $env:CONSULTOR } else { 'irmaosnaobra__' }
# Quem assina a mensagem. A conta gasta o teto; a pessoa assina o texto.
$env:NOME      = if ($env:NOME)      { $env:NOME }      else { 'Thiago' }
node worker.mjs --dry --canal=instagram

Write-Host ''
Write-Host '  Gostou do tom?  ->  .\3-COMECAR.ps1' -ForegroundColor Cyan
Write-Host '  Quer mudar?     ->  me diga o que trocar' -ForegroundColor DarkGray
Write-Host ''

Fim '.\\3-COMECAR.ps1  (se as mensagens estiverem boas)'
