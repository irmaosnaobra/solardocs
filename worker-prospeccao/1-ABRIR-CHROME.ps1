# ─────────────────────────────────────────────────────────────────────────────
#  PASSO 1 — abre o Chrome que a agente vai dirigir.
#
#  Perfil SEPARADO do seu Chrome de sempre. A agente nunca vê suas abas, e o
#  seu navegador continua livre pra você usar normalmente.
#
#  Rode assim (botão direito no arquivo → "Executar com PowerShell"), ou:
#      powershell -ExecutionPolicy Bypass -File .\1-ABRIR-CHROME.ps1
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


$porta  = 9222
$perfil = Join-Path $env:USERPROFILE '.chrome-prospeccao'

Write-Host ''
Write-Host '  ABRINDO O CHROME DA AGENTE' -ForegroundColor Cyan
Write-Host '  ---------------------------------------------------------------'

# Já está de pé? Não abre outro.
try {
  $v = Invoke-RestMethod "http://127.0.0.1:$porta/json/version" -TimeoutSec 3
  Write-Host ''
  Write-Host "  Ja esta aberto: $($v.Browser)" -ForegroundColor Green
  Write-Host '  Pode ir pro passo 2.' -ForegroundColor Green
  Write-Host ''
  Fim; exit 0
} catch { }

# O Chrome mora em lugares diferentes dependendo de como foi instalado.
$caminhos = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $caminhos | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Write-Host ''
  Write-Host '  Nao achei o chrome.exe nos lugares de sempre.' -ForegroundColor Red
  Write-Host '  Procurados:' -ForegroundColor DarkGray
  $caminhos | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  Write-Host ''
  Fim; exit 1
}

Write-Host "  Chrome:  $chrome" -ForegroundColor DarkGray
Write-Host "  Perfil:  $perfil" -ForegroundColor DarkGray
Write-Host ''

# --user-data-dir separa o perfil. Sem ele o Chrome 136+ recusa a porta de debug.
Start-Process $chrome -ArgumentList @(
  "--remote-debugging-port=$porta",
  "--remote-debugging-address=127.0.0.1",
  "--user-data-dir=`"$perfil`"",
  'https://www.instagram.com/'
)

Write-Host '  Esperando o Chrome responder...' -NoNewline
$ok = $false
foreach ($i in 1..30) {
  Start-Sleep -Milliseconds 700
  try { Invoke-RestMethod "http://127.0.0.1:$porta/json/version" -TimeoutSec 2 | Out-Null; $ok = $true; break }
  catch { Write-Host '.' -NoNewline }
}
Write-Host ''
Write-Host ''

if (-not $ok) {
  Write-Host '  O Chrome abriu mas a porta nao respondeu.' -ForegroundColor Red
  Write-Host '  Feche TODAS as janelas do Chrome e rode este arquivo de novo.' -ForegroundColor Yellow
  Write-Host ''
  Fim; exit 1
}

Write-Host '  PRONTO.' -ForegroundColor Green
Write-Host ''
Write-Host '  AGORA, NESSA JANELA QUE ABRIU:' -ForegroundColor Yellow
Write-Host '    Entre na conta de Instagram da prospeccao.'
Write-Host '    So uma vez — a sessao fica salva nesse perfil.'
Write-Host ''
Write-Host '  Depois de logar, rode:  .\2-ENSAIO.ps1' -ForegroundColor Cyan
Write-Host ''

Fim '.\\2-ENSAIO.ps1  (depois de logar no Instagram)'
