@echo off
setlocal
set "PORT=9012"
set "CF_BIN="

if exist "%~dp0cloudflared.exe" set "CF_BIN=%~dp0cloudflared.exe"
if exist "C:\Program Files\cloudflared\cloudflared.exe" set "CF_BIN=C:\Program Files\cloudflared\cloudflared.exe"
if not defined CF_BIN if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set "CF_BIN=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not defined CF_BIN for %%I in (cloudflared.exe) do set "CF_BIN=%%~$PATH:I"

echo ========================================
echo iMedic Cloudflare Tunnel
echo ========================================
echo Puerto local: %PORT%
echo.

if not defined CF_BIN (
  echo ERROR: cloudflared no encontrado.
  echo Instala cloudflared o agrega cloudflared.exe al PATH.
  pause
  exit /b 1
)

echo cloudflared detectado en: %CF_BIN%
echo.

:loop
"%CF_BIN%" tunnel --url "http://127.0.0.1:%PORT%" --loglevel info
echo.
echo Tunnel finalizado con codigo %ERRORLEVEL%.
echo Reintentando en 3 segundos... (Ctrl+C para salir)
timeout /t 3 /nobreak >nul
goto loop

endlocal
