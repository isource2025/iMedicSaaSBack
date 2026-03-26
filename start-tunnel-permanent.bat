@echo off
echo ========================================
echo Iniciando Cloudflare Tunnel Permanente
echo ========================================
echo.
echo Puerto: 3002 (File Server)
echo.

REM Iniciar túnel en puerto 3002 (file server)
cloudflared tunnel --url http://localhost:3002

pause
