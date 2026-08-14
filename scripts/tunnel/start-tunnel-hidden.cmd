@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0config.cmd" call "%~dp0config.cmd"

if not defined IMEDIC_FS_PORT set "IMEDIC_FS_PORT=9012"
if not defined IMEDIC_TUNNEL_LOG set "IMEDIC_TUNNEL_LOG=%ProgramData%\iMedic\adjuntos-tunnel"
if not exist "%IMEDIC_TUNNEL_LOG%" mkdir "%IMEDIC_TUNNEL_LOG%" >nul 2>&1

set "CF_BIN="
if exist "%~dp0..\..\cloudflared.exe" set "CF_BIN=%~dp0..\..\cloudflared.exe"
if exist "C:\Program Files\cloudflared\cloudflared.exe" set "CF_BIN=C:\Program Files\cloudflared\cloudflared.exe"
if not defined CF_BIN if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" set "CF_BIN=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not defined CF_BIN for %%I in (cloudflared.exe) do set "CF_BIN=%%~$PATH:I"

if not defined CF_BIN (
  echo ERROR: cloudflared no encontrado >>"%IMEDIC_TUNNEL_LOG%\tunnel.log"
  exit /b 1
)

>>"%IMEDIC_TUNNEL_LOG%\tunnel.log" echo [%DATE% %TIME%] cloudflared=%CF_BIN% port=%IMEDIC_FS_PORT% name=%IMEDIC_TUNNEL_NAME%

:loop
if defined IMEDIC_TUNNEL_NAME if not "%IMEDIC_TUNNEL_NAME%"=="" (
  "%CF_BIN%" tunnel run "%IMEDIC_TUNNEL_NAME%" >>"%IMEDIC_TUNNEL_LOG%\tunnel.log" 2>&1
) else (
  "%CF_BIN%" tunnel --url "http://127.0.0.1:%IMEDIC_FS_PORT%" --loglevel info >>"%IMEDIC_TUNNEL_LOG%\tunnel.log" 2>&1
)
>>"%IMEDIC_TUNNEL_LOG%\tunnel.log" echo [%DATE% %TIME%] tunnel exit=%ERRORLEVEL% — reintento en 5s
timeout /t 5 /nobreak >nul
goto loop
