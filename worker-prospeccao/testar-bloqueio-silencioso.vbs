' Roda o testar-bloqueio.mjs sem piscar janela. Mesma razao do
' vigia-silencioso.vbs: chamar node.exe direto pela tarefa do Windows cria um
' console na tela. Sao duas vezes por dia, mas o conserto custa nada.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
sh.Run "cmd /c node """ & pasta & "\testar-bloqueio.mjs"" >> """ & pasta & "\teste-bloqueio.log"" 2>&1", 0, False
