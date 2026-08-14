@echo off
REM Una linea equivalente:
REM powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-QuickTunnel.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-QuickTunnel.ps1" %*
