' Sobe o VIGIA.ps1 SEM piscar janela na tela.
'
' Por que este arquivo existe: a tarefa do Windows chamava powershell.exe
' direto com -WindowStyle Hidden. Nao basta. O Windows cria o console ANTES do
' PowerShell ler esse parametro, entao a janela pisca de minuto em minuto na
' cara de quem esta trabalhando.
'
' O wscript com o modo 0 do Run nao cria console nenhum. E a unica forma de
' rodar de verdade escondido sem privilegio de Administrador (com admin daria
' pra marcar "executar esteja o usuario conectado ou nao", que tambem esconde).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & pasta & "\VIGIA.ps1""", 0, False
