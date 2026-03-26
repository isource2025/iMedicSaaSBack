@echo off
echo ========================================
echo iMedic File Server - PowerShell
echo ========================================
echo.
echo Iniciando servidor en puerto 3002...
echo.

REM Ejecutar el servidor PowerShell
powershell -ExecutionPolicy Bypass -File "%~dp0file-server.ps1"

pause
