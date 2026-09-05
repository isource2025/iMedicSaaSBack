@echo off
:: Doble clic en la PC de Vidal (como el Quick Tunnel viejo).
:: Instala el tunel FIJO files-vidal.imedic.com.ar + file server + FileServerUrl.
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Pedimos Administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-NamedTunnel.ps1"
echo.
pause
