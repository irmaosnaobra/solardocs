' Sobe o COMECAR.ps1 (a agente, valendo) sem janela na tela.
' Mesma razao dos outros .vbs: powershell.exe -WindowStyle Hidden ainda cria o
' console antes de esconder, e pela tarefa do Windows isso vira piscada.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & pasta & "\COMECAR.ps1"" --valendo", 0, False
