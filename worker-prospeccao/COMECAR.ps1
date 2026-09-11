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

# -- nao deixe o computador dormir enquanto ela trabalha ---------------------
# Em 11/09 a maquina entrou em espera as 06:52 e so acordou as 11:36. A agente
# nao mandou nada a manha inteira, e nao foi por falta de fila nem de teto: ela
# estava congelada junto com o Windows.
#
# SetThreadExecutionState e o jeito certo porque vale SO enquanto esta janela
# estiver aberta. Mexer no plano de energia deixaria o computador sem dormir
# pra sempre, inclusive depois que voce parasse a agente.
#   ES_CONTINUOUS      0x80000000  vale ate eu dizer o contrario
#   ES_SYSTEM_REQUIRED 0x00000001  o sistema nao dorme (a tela pode apagar)
try {
  Add-Type -Name Energia -Namespace Win32 -MemberDefinition '
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);' -ErrorAction Stop
  [void][Win32.Energia]::SetThreadExecutionState(0x80000000 -bor 0x00000001)
  $seguraAcordado = $true
} catch { $seguraAcordado = $false }
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
Write-Host '  Janela: 24 horas por dia (o teto do dia e que limita, nao o relogio)'
Write-Host '  Radar:  https://solardoc.app/gerador/radar/' -ForegroundColor Cyan
Write-Host ''
Write-Host '  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar.' -ForegroundColor Yellow
Write-Host '  ------------------------------------------------------------'
Write-Host ''

if ($seguraAcordado) { Write-Host '  O computador nao vai dormir enquanto esta janela estiver aberta.' -ForegroundColor DarkGray }
else { Write-Host '  ATENCAO: nao consegui impedir o computador de dormir.' -ForegroundColor Yellow }
Write-Host ''

# -- ela nao pode morrer calada ---------------------------------------------
# O Start-Transcript do PowerShell NAO captura a saida de um programa externo:
# o AGENTE.log parava na linha de abertura e tudo que a agente fez sumia. Em
# 11/09 ela morreu de madrugada e nao sobrou uma linha pra dizer por que.
# Tee-Object joga nos dois lugares: na tela pra voce ver, e no arquivo pra eu
# ler depois.
$arg = if ($valendo) { @('worker.mjs','--modo=continuo','--canal=instagram') }
       else          { @('worker.mjs','--dry','--modo=continuo','--canal=instagram') }
$diario = Join-Path $PSScriptRoot 'agente-diario.log'

# -- e se cair, volta sozinha -----------------------------------------------
# Queda de rede, Instagram fora do ar, Chrome reiniciado: qualquer um derruba o
# node. Sem isto ela fica morta ate voce reparar, que foi o que aconteceu hoje.
# Os 60s de espera sao proposital: se o motivo da queda ainda estiver de pe,
# martelar a cada segundo so piora.
$voltas = 0
while ($true) {
  $inicio = Get-Date
  "[$($inicio.ToString('dd/MM HH:mm:ss'))] ligando a agente (volta $voltas)" | Tee-Object -FilePath $diario -Append
  & node @arg 2>&1 | Tee-Object -FilePath $diario -Append
  $fim = Get-Date
  $viva = [int]($fim - $inicio).TotalMinutes
  "[$($fim.ToString('dd/MM HH:mm:ss'))] caiu depois de $viva min, volto em 60s" | Tee-Object -FilePath $diario -Append
  Write-Host ''
  Write-Host "  A agente caiu depois de $viva min. Religando em 60 segundos..." -ForegroundColor Yellow
  Write-Host '  (Ctrl+C agora se voce quiser parar de vez)' -ForegroundColor DarkGray
  Write-Host ''
  Start-Sleep -Seconds 60
  $voltas++
}

Write-Host ''
Write-Host '  A agente parou.' -ForegroundColor Yellow
try { Stop-Transcript | Out-Null } catch { }
Write-Host '  --- Aperte Enter para fechar ---' -ForegroundColor Yellow
[void](Read-Host)
