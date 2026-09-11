# ═════════════════════════════════════════════════════════════════════════════
#  INSTALA A AGENTE COMO TAREFA DO WINDOWS
#
#  O que isto resolve: ate hoje a agente dependia de uma janela do PowerShell
#  ficar aberta. Fechou a janela, desligou o computador, o Windows reiniciou
#  pra atualizar: ela morria e ficava morta ate alguem reparar. Foi o que
#  aconteceu em 11/09, das 04h as 11h44.
#
#  O Agendador de Tarefas do Windows e o supervisor que o proprio sistema ja
#  tem. Ele liga a agente quando a maquina liga, quando voce entra na conta, e
#  religa se ela cair inteira. E de graca, e nao depende de mais nada.
#
#  RODE UMA VEZ, como Administrador. Depois disso pode esquecer.
#  Pra desinstalar:  .\INSTALAR-TAREFA.ps1 -Remover
# ═════════════════════════════════════════════════════════════════════════════
param([switch]$Remover)

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 | Out-Null } catch { }
$ErrorActionPreference = 'Stop'

$NOME    = 'AgenteProspeccao'
$pasta   = $PSScriptRoot
$script  = Join-Path $pasta 'COMECAR.ps1'

function Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ''
if ($Remover) {
  try { Unregister-ScheduledTask -TaskName $NOME -Confirm:$false; Write-Host "  Tarefa '$NOME' removida." -ForegroundColor Yellow }
  catch { Write-Host "  Nao havia tarefa '$NOME' instalada." -ForegroundColor DarkGray }
  Write-Host ''
  exit 0
}

if (-not (Admin)) {
  Write-Host '  Preciso rodar como Administrador.' -ForegroundColor Red
  Write-Host '  Clique com o botao direito neste arquivo e escolha' -ForegroundColor Yellow
  Write-Host '  "Executar com o PowerShell" a partir de um PowerShell de Administrador.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  --- Aperte Enter para fechar ---'
  [void](Read-Host); exit 1
}
if (-not (Test-Path $script)) { Write-Host "  Nao achei $script" -ForegroundColor Red; exit 1 }

# ── a acao ───────────────────────────────────────────────────────────────────
# -WindowStyle Hidden: ela trabalha sem janela na sua frente. O diario continua
# em agente-diario.log, entao voce nao perde nada vendo menos.
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $pasta -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '" --valendo')

# ── quando liga ──────────────────────────────────────────────────────────────
# Os dois gatilhos existem por motivos diferentes e nenhum cobre o outro:
#   AtStartup  o computador foi reiniciado (queda de luz, Windows Update)
#   AtLogOn    voce entrou na conta. E o que pega o caso mais comum, que e a
#              maquina ligada mas a sessao reiniciada
$gatilhos = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)

# ── as regras ────────────────────────────────────────────────────────────────
# RestartCount/Interval: se a tarefa INTEIRA morrer, o Windows religa. Isso e
# uma rede diferente da que o COMECAR.ps1 ja tem: la dentro o laco religa o
# `node`; aqui o Windows religa o laco. A janela fechada so o Windows cobre.
#
# ExecutionTimeLimit 0 = sem prazo. O padrao do Windows e matar a tarefa depois
# de 3 dias, que numa agente que roda pra sempre e uma bomba-relogio.
#
# DontStopIfGoingOnBatteries + AllowStartIfOnBatteries: notebook no cabo que
# cai pra bateria por 2 minutos nao pode derrubar o dia.
$regras = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

# -LogonType Interactive: ela PRECISA da sua sessao, porque usa o Chrome logado
# no Instagram. Rodar como servico sem sessao nao enxergaria esse Chrome.
$conta = New-ScheduledTaskPrincipal -UserId ("$env:USERDOMAIN\$env:USERNAME") -LogonType Interactive -RunLevel Highest

try { Unregister-ScheduledTask -TaskName $NOME -Confirm:$false -ErrorAction SilentlyContinue } catch { }
Register-ScheduledTask -TaskName $NOME -Action $acao -Trigger $gatilhos `
  -Settings $regras -Principal $conta `
  -Description 'Agente de prospeccao do SolarDoc. Liga no boot e no logon, religa sozinha se cair. Diario em worker-prospeccao/agente-diario.log' | Out-Null

Write-Host "  Tarefa '$NOME' instalada." -ForegroundColor Green
Write-Host ''
Write-Host '  A partir de agora ela liga sozinha:'
Write-Host '    - quando o computador liga'
Write-Host '    - quando voce entra na sua conta'
Write-Host '    - 2 minutos depois, se cair inteira'
Write-Host ''
Write-Host '  Ligar agora:     schtasks /run  /tn AgenteProspeccao'
Write-Host '  Parar:           schtasks /end  /tn AgenteProspeccao'
Write-Host '  Ver o estado:    schtasks /query /tn AgenteProspeccao /v /fo LIST'
Write-Host '  Desinstalar:     .\INSTALAR-TAREFA.ps1 -Remover'
Write-Host ''
Write-Host '  O que ela faz aparece em agente-diario.log, na mesma pasta.' -ForegroundColor DarkGray
Write-Host ''
