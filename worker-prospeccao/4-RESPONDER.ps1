# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 4 — A agente le quem respondeu e responde sozinha.
#  Rode algumas vezes ao longo do dia. So gasta IA em conversa que teve resposta.
# ─────────────────────────────────────────────────────────────────────────────
# ── nao deixe a janela sumir ─────────────────────────────────────────────────
# Executar-com-PowerShell fecha a janela no fim, e o erro vai junto. Transcript
# grava tudo num arquivo; o finally segura a janela ate alguem apertar Enter.
# ── console em UTF-8 ─────────────────────────────────────────────────────────
# Sem isto o console usa a pagina de codigo antiga e a saida do Node vira
# "ÔòöÔòÉ" no lugar dos acentos e das molduras.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch { }

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

Fim ''
