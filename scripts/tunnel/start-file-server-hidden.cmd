@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0config.cmd" call "%~dp0config.cmd"

if not defined IMEDIC_FS_PORT set "IMEDIC_FS_PORT=9012"
if not defined IMEDIC_FS_ROOT set "IMEDIC_FS_ROOT=E:\adjuntos"
if not defined IMEDIC_FS_FALLBACK set "IMEDIC_FS_FALLBACK=C:\imedic-adjuntos"
if not defined IMEDIC_TUNNEL_LOG set "IMEDIC_TUNNEL_LOG=%ProgramData%\iMedic\adjuntos-tunnel"

if not exist "%IMEDIC_TUNNEL_LOG%" mkdir "%IMEDIC_TUNNEL_LOG%" >nul 2>&1

set "IMEDIC_NOPAUSE=1"
set "PORT=%IMEDIC_FS_PORT%"
set "ROOT=%IMEDIC_FS_ROOT%"
set "FALLBACK_ROOT=%IMEDIC_FS_FALLBACK%"

REM Reusa el file server del repo (HttpListener, sin Node)
set "FS_BAT=%~dp0..\..\start-file-server.bat"
if not exist "%FS_BAT%" (
  echo ERROR: no se encontro start-file-server.bat
  exit /b 1
)

>>"%IMEDIC_TUNNEL_LOG%\file-server.log" echo [%DATE% %TIME%] start port=%PORT% root=%ROOT%
call "%FS_BAT%" >>"%IMEDIC_TUNNEL_LOG%\file-server.log" 2>&1
endlocal
