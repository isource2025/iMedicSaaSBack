@echo off
echo ========================================
echo Iniciando Sistema Completo iMedicWs
echo ========================================
echo.

echo [1/4] Iniciando Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3002"

echo [2/4] Esperando 5 segundos para establecer tunel...
timeout /t 5 /nobreak

echo [3/4] Iniciando File Server (puerto 3002)...
start "File Server" cmd /k "npm run file-server"

echo [4/4] Esperando 3 segundos...
timeout /t 3 /nobreak

echo [5/4] Iniciando Backend API (puerto 3001)...
start "Backend API" cmd /k "npm run dev"

echo.
echo ========================================
echo Sistema iniciado correctamente
echo ========================================
echo.
echo VENTANAS ABIERTAS:
echo   1. Cloudflare Tunnel - Copia la URL que aparece aqui
echo   2. File Server - Puerto 3002
echo   3. Backend API - Puerto 3001
echo.
echo SIGUIENTE PASO:
echo   1. Copia la URL del tunel (ej: https://abc123.trycloudflare.com)
echo   2. Actualiza .env: FILE_SERVER_URL=https://abc123.trycloudflare.com
echo   3. Actualiza Vercel: NEXT_PUBLIC_FILE_SERVER_URL=https://abc123.trycloudflare.com
echo.
pause
