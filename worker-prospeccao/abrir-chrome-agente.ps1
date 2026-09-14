# ═════════════════════════════════════════════════════════════════════════════
#  ABRE O CHROME DA AGENTE NUMA AREA DE TRABALHO ESCONDIDA DO WINDOWS.
#
#  POR QUE: em 14/09 o dono reclamou tres vezes que "o Instagram fica abrindo
#  toda hora sozinho". Minimizar nao resolveu: a janela aparecia por alguns
#  segundos a cada reabertura, ele fechava (o perfil registrou saida NORMAL, sem
#  nenhum travamento), o vigia reabria, e o ciclo recomecava.
#
#  O Windows tem areas de trabalho alem da que aparece na tela. Janela aberta la
#  nunca aparece, nao tem botao na barra de tarefas e nao rouba o foco. O Chrome
#  trabalha igual: testado em 14/09 num perfil descartavel, carregou pagina,
#  navegou, rodou timer no tempo certo, desenhou a tela e disse
#  visibilityState=visible. A agente fala com ele pela porta 9222, como sempre.
#
#  Uso:
#    abrir-chrome-agente.ps1           abre escondido (o normal)
#    abrir-chrome-agente.ps1 -Mostrar  fecha o escondido e abre NA TELA por 30
#                                      min, pra logar no Instagram ou ler o QR
#                                      do WhatsApp. Depois o vigia esconde de novo.
# ═════════════════════════════════════════════════════════════════════════════
param([switch]$Mostrar)
$ErrorActionPreference = 'Stop'

$porta        = 9222
$perfil       = Join-Path $env:USERPROFILE '.chrome-prospeccao'
$marcaVisivel = Join-Path $PSScriptRoot 'chrome-visivel.flag'
$mesa         = 'AgenteProspeccao'

$chrome = @("${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
          Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Output 'NAO ACHEI o chrome.exe.'; exit 1 }

# Os mesmos cortes de memoria de sempre: ela e um robo, nao precisa de GPU,
# traducao, sincronizacao nem um processo por site.
$flags = @(
  "--remote-debugging-port=$porta", '--remote-debugging-address=127.0.0.1',
  ('--user-data-dir="' + $perfil + '"'),
  '--disable-features=site-per-process,Translate,OptimizationHints,MediaRouter',
  '--disable-gpu', '--disable-extensions', '--disable-sync',
  '--disable-background-networking', '--disable-component-update',
  '--no-default-browser-check', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--js-flags=--max-old-space-size=512'
)
$inicio = 'https://www.instagram.com/'

function FecharChromeDaAgente {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like '*chrome-prospeccao*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
}

$marcaValendo = (Test-Path $marcaVisivel) -and
  (((Get-Date) - (Get-Item $marcaVisivel).LastWriteTime).TotalMinutes -lt 30)

if ($Mostrar -or $marcaValendo) {
  if ($Mostrar) {
    Set-Content -Path $marcaVisivel -Value (Get-Date).ToString('o')
    FecharChromeDaAgente
  }
  Start-Process $chrome -ArgumentList ($flags + $inicio)
  Write-Output 'Chrome da agente aberto NA TELA por ate 30 minutos.'
  exit 0
}

if (-not ('MesaDaAgente' -as [type])) {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class MesaDaAgente {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateDesktop(string name, IntPtr dev, IntPtr mode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktop(string name, int flags, bool inherit, uint access);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Abrir(string mesa, string app, string linha) {
    // GENERIC_ALL. A area de trabalho continua existindo enquanto o Chrome
    // estiver nela, mesmo depois que este PowerShell sair.
    IntPtr d = OpenDesktop(mesa, 0, false, 0x10000000);
    if (d == IntPtr.Zero) d = CreateDesktop(mesa, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
    if (d == IntPtr.Zero) throw new Exception("CreateDesktop falhou: " + Marshal.GetLastWin32Error());
    STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.lpDesktop = "WinSta0\\" + mesa;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(app, linha, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi))
      throw new Exception("CreateProcess falhou: " + Marshal.GetLastWin32Error());
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return pi.dwProcessId;
  }
}
"@
}

$linha = '"' + $chrome + '" ' + ($flags -join ' ') + ' ' + $inicio
$pidChrome = [MesaDaAgente]::Abrir($mesa, $chrome, $linha)
Write-Output "Chrome da agente aberto na area de trabalho escondida (PID $pidChrome)."
