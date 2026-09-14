' Sobe a agente do WHATSAPP (COMECAR.ps1 --whatsapp, valendo) sem janela na tela.
' Irma do agente-silenciosa.vbs, que sobe a do Instagram. Quem chama e o
' VIGIA.ps1, e so depois que o LIGAR-WHATSAPP deixou a marca whatsapp-ligado.flag.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & pasta & "\COMECAR.ps1"" --valendo --whatsapp", 0, False
