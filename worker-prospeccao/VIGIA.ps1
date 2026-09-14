# ═════════════════════════════════════════════════════════════════════════════
#  VIGIA — de minuto em minuto, garante que a agente esteja de pe.
#
#  POR QUE ISTO EXISTE
#  O COMECAR.ps1 ja tem um laco que religa o `node` quando ele cai. Mas isso so
#  cobre o node. Em 13/09 morreram os DOIS ao mesmo tempo (o Windows matou por
#  falta de memoria) e nao sobrou ninguem pra levantar: a agente ficou parada
#  ate alguem perguntar "o que houve?".
#
#  Este arquivo e o de fora. Ele nao trabalha, so confere tres coisas e conserta
#  o que faltar:
#    1. o Chrome dela responde na porta de depuracao?
#    2. o worker esta rodando?
#    3. tem mais de uma instancia? (duas dirigem o mesmo Chrome e quebram)
#
#  Roda pela tarefa do Windows a cada 1 minuto. Custa quase nada: tres consultas
#  e sai.
# ═════════════════════════════════════════════════════════════════════════════
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch { }
$ErrorActionPreference = 'Continue'

$pasta  = $PSScriptRoot
$porta  = 9222
$perfil = Join-Path $env:USERPROFILE '.chrome-prospeccao'
$diario = Join-Path $pasta 'vigia.log'

function Anotar($msg) {
  $linha = "[$((Get-Date).ToString('dd/MM HH:mm:ss'))] $msg"
  Write-Host $linha
  try { Add-Content -Path $diario -Value $linha -Encoding UTF8 } catch { }
}

# ── 1. o Chrome dela esta de pe? ─────────────────────────────────────────────
$chromeVivo = $false
try { Invoke-RestMethod "http://127.0.0.1:$porta/json/version" -TimeoutSec 5 | Out-Null; $chromeVivo = $true } catch { }

if (-not $chromeVivo) {
  Anotar 'o Chrome dela nao respondeu. Subindo.'
  # Mata resto de processo do perfil dela antes: Chrome meio morto segura a
  # porta e o novo nao sobe.
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like '*chrome-prospeccao*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3

  $chrome = @("${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
              "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
              "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
            Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) {
    Start-Process $chrome -ArgumentList @(
      "--remote-debugging-port=$porta", '--remote-debugging-address=127.0.0.1',
      "--user-data-dir=`"$perfil`"",
      '--disable-gpu', '--disable-extensions', '--disable-sync',
      '--disable-background-networking', '--disable-component-update',
      '--no-default-browser-check', '--no-first-run',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'https://www.instagram.com/')
    Start-Sleep -Seconds 12
    Anotar 'Chrome subido.'
  } else { Anotar 'NAO ACHEI o chrome.exe.' }
}

# ── 2 e 3. cada agente de pe, e so uma de cada ───────────────────────────────
# Sao duas identidades: a do Instagram (sempre) e a do WhatsApp (so depois que
# alguem leu o QR e o LIGAR-WHATSAPP deixou a marca whatsapp-ligado.flag).
# Cada uma e conferida e deduplicada SEPARADA: contar as duas juntas mataria a
# segunda achando que era duplicata da primeira.
#
# SOBE DIRETO, sem pedir pro Agendador. Chamar `schtasks /run` parecia mais
# limpo, mas o Agendador recusa a chamada em varias situacoes (0x800710E0) e nao
# explica qual. Em 13/09 ele recusou tres vezes seguidas e a agente ficou no
# chao enquanto o vigia achava que tinha resolvido. O .vbs existe porque
# powershell.exe -WindowStyle Hidden ainda pisca o console antes de esconder.
#
# Duas agentes do MESMO canal dirigem a mesma conta ao mesmo tempo e disputam o
# mesmo teto. O worker ja tem trava propria, mas ela depende do pulso: se duas
# subirem no mesmo segundo, as duas passam. Aqui o corte e bruto e sempre
# funciona: fica a mais VELHA, que e a que ja estava trabalhando.
function Garantir([string]$canal, [string]$vbsNome) {
  $meus = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*worker.mjs*' } |
    Where-Object {
      if ($canal -eq 'whatsapp') { $_.CommandLine -like '*--canal=whatsapp*' }
      else { $_.CommandLine -notlike '*--canal=whatsapp*' }
    })

  if ($meus.Count -eq 0) {
    $janelas = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
      Where-Object { $_.CommandLine -like '*COMECAR.ps1*' -and $_.CommandLine -notlike '*Where-Object*' } |
      Where-Object {
        if ($canal -eq 'whatsapp') { $_.CommandLine -like '*--whatsapp*' }
        else { $_.CommandLine -notlike '*--whatsapp*' }
      })
    if ($janelas.Count -gt 0) {
      Anotar "[$canal] a agente nao roda, mas a janela existe (PID $($janelas[0].ProcessId)). Ela religa sozinha em 60s."
    } else {
      Anotar "[$canal] a agente nao estava rodando e nao havia janela. Subindo direto."
      $vbs = Join-Path $pasta $vbsNome
      if (Test-Path $vbs) { Start-Process 'wscript.exe' -ArgumentList @('//nologo', "`"$vbs`"") -WindowStyle Hidden }
      else { Anotar "NAO ACHEI $vbsNome" }
    }
  }
  elseif ($meus.Count -gt 1) {
    Anotar "[$canal] havia $($meus.Count) agentes ao mesmo tempo. Deixando so a mais antiga."
    $meus | Sort-Object CreationDate | Select-Object -Skip 1 | ForEach-Object {
      Anotar "  matando a duplicata PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

Garantir 'instagram' 'agente-silenciosa.vbs'
if (Test-Path (Join-Path $pasta 'whatsapp-ligado.flag')) {
  Garantir 'whatsapp' 'agente-whatsapp-silenciosa.vbs'
}

# ── 4. o diario nao pode crescer pra sempre ──────────────────────────────────
# Rodando de minuto em minuto, um ano dariam meio milhao de linhas. Corta em
# 2000, que cobre mais de um dia de historico.
try {
  if ((Test-Path $diario) -and (Get-Item $diario).Length -gt 300KB) {
    $ultimas = Get-Content $diario -Tail 2000
    Set-Content -Path $diario -Value $ultimas -Encoding UTF8
  }
} catch { }
