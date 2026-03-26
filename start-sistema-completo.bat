@echo off
echo ========================================
echo iMedic - Sistema Completo
echo Tunnel + File Server (PowerShell)
echo ========================================
echo.

echo [1/2] Iniciando Cloudflare Tunnel...
start "iMedic Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3002"

echo [2/2] Esperando 5 segundos...
timeout /t 5 /nobreak

echo Iniciando File Server (PowerShell)...
start "iMedic File Server" cmd /k "powershell -ExecutionPolicy Bypass -File %~dp0file-server.ps1"

echo.
echo ========================================
echo Sistema iniciado
echo ========================================
echo.
echo VENTANAS ABIERTAS:
echo   1. iMedic Tunnel - Copia la URL del tunel
echo   2. iMedic File Server - Servidor PowerShell
echo.
echo SIGUIENTE PASO:
echo   1. Copia la URL del tunel (ej: https://abc123.trycloudflare.com)
echo   2. Configura en Render: FILE_SERVER_URL
echo   3. Configura en Vercel: NEXT_PUBLIC_FILE_SERVER_URL
echo.
pause
