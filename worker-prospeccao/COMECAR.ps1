# ═════════════════════════════════════════════════════════════════════════════
#  COMEÇAR — um clique. Faz tudo.
#
#  1. abre o Chrome da agente (se ainda não estiver aberto)
#  2. espera você logar no Instagram, se precisar
#  3. liga a agente e deixa ela trabalhando das 07:00 às 23:59
#
#  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar a qualquer hora.
# ═════════════════════════════════════════════════════════════════════════════

# ── console em UTF-8 ─────────────────────────────────────────────────────────
# Sem isto o console usa a pagina de codigo antiga e a saida do Node vira
# "ÔòöÔòÉ" no lugar dos acentos e das molduras.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch { }

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$porta  = 9222
$perfil = Join-Path $env:USERPROFILE '.chrome-prospeccao'
$log    = Join-Path $PSScriptRoot 'AGENTE.log'
try { Stop-Transcript | Out-Null } catch { }
try { Start-Transcript -Path $log -Force -Append | Out-Null } catch { }

function Parar([string]$msg, [string]$cor = 'Red') {
  Write-Host ''; Write-Host "  $msg" -ForegroundColor $cor; Write-Host ''
  try { Stop-Transcript | Out-Null } catch { }
  Write-Host '  --- Aperte Enter para fechar ---' -ForegroundColor Yellow
  [void](Read-Host); exit 1
}
function Porta { try { Invoke-RestMethod "http://127.0.0.1:$porta/json/version" -TimeoutSec 3 | Out-Null; $true } catch { $false } }

Clear-Host
Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║           AGENTE DE PROSPECÇÃO — SOLARDOC            ║' -ForegroundColor Cyan
Write-Host '  ╚══════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ── 1. Chrome ────────────────────────────────────────────────────────────────
if (Porta) {
  Write-Host '  [1/3] Chrome da agente ja esta aberto.' -ForegroundColor Green
} else {
  Write-Host '  [1/3] Abrindo o Chrome da agente...' -ForegroundColor Yellow
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $chrome) { Parar 'Nao achei o chrome.exe. Me avise que eu procuro junto.' }

  Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=$porta", '--remote-debugging-address=127.0.0.1',
    "--user-data-dir=`"$perfil`"", 'https://www.instagram.com/'
  )
  foreach ($i in 1..40) { Start-Sleep -Milliseconds 700; if (Porta) { break } }
  if (-not (Porta)) { Parar 'O Chrome abriu mas a porta nao respondeu. Feche TODAS as janelas do Chrome e clique aqui de novo.' }
  Write-Host '        Chrome aberto.' -ForegroundColor Green
}

# ── 2. sessão do Instagram ───────────────────────────────────────────────────
Write-Host ''
Write-Host '  [2/3] Conferindo a conta do Instagram...' -ForegroundColor Yellow
$logado = $false
foreach ($i in 1..60) {
  $r = (node checar-sessao.mjs 2>$null) -join ''
  if ($r -match 'LOGADO:(\S+)') {
    Write-Host "        Logado como @$($Matches[1])" -ForegroundColor Green
    $logado = $true; break
  }
  if ($i -eq 1) {
    Write-Host ''
    Write-Host '        >>> ENTRE NA CONTA DO INSTAGRAM NA JANELA DO CHROME <<<' -ForegroundColor Yellow
    Write-Host '        (eu espero aqui — assim que voce logar, comeco sozinho)' -ForegroundColor DarkGray
    Write-Host ''
  }
  Start-Sleep -Seconds 5
}
if (-not $logado) { Parar 'Nao consegui confirmar o login em 5 minutos. Logue no Instagram e clique aqui de novo.' 'Yellow' }

# ── 3. liga a agente ─────────────────────────────────────────────────────────
$env:CONSULTOR = if ($env:CONSULTOR) { $env:CONSULTOR } else { 'irmaosnaobra__' }
$env:NOME      = if ($env:NOME)      { $env:NOME }      else { 'Thiago' }

# Sem --valendo ela so ENSAIA. Proposital: um clique acidental nao dispara
# mensagem pra ninguem — quem manda de verdade precisa dizer que quer.
$valendo = $args -contains '--valendo'

Write-Host ''
Write-Host '  [3/3] Ligando a agente...' -ForegroundColor Yellow
Write-Host ''
if ($valendo) {
  Write-Host '  ╔══════════════════════════════════════════════════════╗' -ForegroundColor Green
  Write-Host '  ║  VALENDO — ela esta abordando e respondendo de verdade║' -ForegroundColor Green
  Write-Host '  ╚══════════════════════════════════════════════════════╝' -ForegroundColor Green
} else {
  Write-Host '  ╔══════════════════════════════════════════════════════╗' -ForegroundColor Cyan
  Write-Host '  ║  ENSAIO — mostra tudo, nao manda mensagem pra ninguem ║' -ForegroundColor Cyan
  Write-Host '  ║  Pra valer: clique com o botao direito > Executar,    ║' -ForegroundColor Cyan
  Write-Host '  ║  ou use o atalho "COMECAR (valendo)"                  ║' -ForegroundColor Cyan
  Write-Host '  ╚══════════════════════════════════════════════════════╝' -ForegroundColor Cyan
}
Write-Host ''
Write-Host "  Conta:  $env:CONSULTOR   (assina como $env:NOME)"
Write-Host '  Janela: 07:00 as 23:59'
Write-Host '  Radar:  https://solardoc.app/gerador/radar/' -ForegroundColor Cyan
Write-Host ''
Write-Host '  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar.' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'
Write-Host ''

if ($valendo) { node worker.mjs --modo=continuo --canal=instagram }
else          { node worker.mjs --dry --modo=continuo --canal=instagram }

Write-Host ''
Write-Host '  A agente parou.' -ForegroundColor Yellow
try { Stop-Transcript | Out-Null } catch { }
Write-Host '  --- Aperte Enter para fechar ---' -ForegroundColor Yellow
[void](Read-Host)
