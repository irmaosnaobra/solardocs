@echo off
rem Traz o Chrome da agente pra TELA por 30 minutos: pra logar no Instagram ou
rem conferir o que ela esta fazendo. Depois o vigia esconde de novo sozinho.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0abrir-chrome-agente.ps1" -Mostrar
echo.
echo   O Chrome da agente esta na tela por 30 minutos. Depois ele volta a ficar escondido.
echo.
pause
