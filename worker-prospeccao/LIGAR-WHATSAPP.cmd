@echo off
rem LIGAR O WHATSAPP DA PROSPECCAO. Dois cliques, com o celular do CHIP NOVO na mao.
rem Abre o WhatsApp Web no Chrome da agente, espera o QR ser lido, recusa a
rem linha IO e o celular do dono, e liga a agente do WhatsApp.
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   LIGAR O WHATSAPP DA PROSPECCAO
echo.
node ligar-whatsapp.mjs
if %errorlevel%==0 (
  wscript //nologo "%~dp0agente-whatsapp-silenciosa.vbs"
  echo   A agente do WhatsApp esta subindo. O vigia mantem ela de pe daqui pra frente.
)
echo.
pause
