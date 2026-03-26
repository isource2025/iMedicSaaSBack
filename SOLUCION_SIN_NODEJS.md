# 🎯 Solución Final: Túnel + SQL Server (SIN Node.js)

## 📋 Problema

La máquina donde está SQL Server **NO tiene Node.js ni npm instalado**, y no se puede/quiere instalar nada adicional.

## ✅ Solución: Servidor HTTP con PowerShell

**PowerShell ya viene instalado en Windows**, no requiere dependencias adicionales.

---

## 🏗️ Arquitectura

```
┌─────────────┐         ┌──────────────────┐
│   Vercel    │────────>│  Render Backend  │
│  (Frontend) │  HTTPS  │  (Cloud)         │
└─────────────┘         └──────────────────┘
                                │
                                │ FILE_SERVER_URL
                                ▼
                        ┌──────────────────┐
                        │ Cloudflare Tunnel│
                        │ (Público)        │
                        └──────────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │  Máquina SQL Server           │
                │  (Windows Server)             │
                │                               │
                │  ┌─────────────┐              │
                │  │ SQL Server  │              │
                │  └─────────────┘              │
                │                               │
                │  ┌─────────────┐              │
                │  │ PowerShell  │              │
                │  │ HTTP Server │              │
                │  │ (Puerto 3002)              │
                │  └─────────────┘              │
                │         │                     │
                │         ▼                     │
                │  ┌─────────────┐              │
                │  │ E:\adjuntos\│              │
                │  └─────────────┘              │
                └───────────────────────────────┘
```

**Componentes:**
- ✅ SQL Server (ya instalado)
- ✅ PowerShell HTTP Server (sin instalar nada)
- ✅ Cloudflare Tunnel (solo ejecutable portable)
- ✅ Backend en Render
- ✅ Frontend en Vercel

---

## 🚀 PASO 1: Copiar Archivos a la Máquina SQL

### En la máquina SQL Server

```powershell
# 1. Crear carpeta
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA
mkdir FileServer
cd FileServer

# 2. Copiar estos archivos desde iMedicWSBack:
#    - file-server.ps1
#    - start-file-server.bat
#    - start-sistema-completo.bat
```

**Archivos necesarios:**
- `file-server.ps1` - Servidor HTTP en PowerShell
- `start-file-server.bat` - Inicia el servidor
- `start-sistema-completo.bat` - Inicia túnel + servidor
- `cloudflared.exe` - Ejecutable del túnel (descargar)

---

## 🌐 PASO 2: Instalar Cloudflare Tunnel (Solo Ejecutable)

### Opción 1: Con winget (si está disponible)

```powershell
winget install --id Cloudflare.cloudflared
```

### Opción 2: Ejecutable portable (SIN INSTALACIÓN)

```powershell
# 1. Descargar desde:
# https://github.com/cloudflare/cloudflared/releases

# 2. Buscar: cloudflared-windows-amd64.exe

# 3. Copiar a: C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer\

# 4. Renombrar a: cloudflared.exe
```

### Crear `start-tunnel.bat`

```batch
@echo off
echo ========================================
echo iMedic - Cloudflare Tunnel
echo ========================================
echo.

REM Si cloudflared está en PATH
cloudflared tunnel --url http://localhost:3002

REM Si usas el ejecutable portable
REM %~dp0cloudflared.exe tunnel --url http://localhost:3002

pause
```

---

## ⚙️ PASO 3: Iniciar el Sistema

### Opción 1: Script Automatizado (Recomendado)

```powershell
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# Ejecutar
.\start-sistema-completo.bat
```

Esto abrirá 2 ventanas:
1. **Túnel** - Copia la URL que aparece
2. **File Server** - Servidor PowerShell

### Opción 2: Manual

**Terminal 1 - Túnel:**
```powershell
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
cloudflared tunnel --url http://localhost:3002
```

**Terminal 2 - File Server:**
```powershell
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
.\start-file-server.bat
```

---

## 📋 PASO 4: Copiar URL del Túnel

Cuando ejecutes el túnel, verás:

```
Your quick Tunnel has been created! Visit it at:
https://abc123-def-456.trycloudflare.com
```

**⚠️ IMPORTANTE:** Copia esta URL completa.

---

## ☁️ PASO 5: Configurar Render (Backend)

```
1. Ir a: https://dashboard.render.com/
2. Seleccionar: iMedicWSBack
3. Environment → Agregar/Actualizar:
   
   FILE_SERVER_URL = https://abc123-def-456.trycloudflare.com

4. Save Changes
```

Render redesplegará automáticamente el backend.

---

## ☁️ PASO 6: Configurar Vercel (Frontend)

```
1. Ir a: https://vercel.com/dashboard
2. Seleccionar: iMedicWSFront
3. Settings → Environment Variables → Agregar/Actualizar:
   
   NEXT_PUBLIC_FILE_SERVER_URL = https://abc123-def-456.trycloudflare.com

4. Deployments → Redeploy
```

---

## 🔍 PASO 7: Verificación

### 1. Verificar File Server Local

```powershell
# Desde la máquina SQL
curl http://localhost:3002/health

# O abrir en navegador:
# http://localhost:3002/health
```

**Respuesta esperada:**
```json
{
  "success": true,
  "status": "OK",
  "timestamp": "2026-03-26T...",
  "server": "iMedic File Server (PowerShell)"
}
```

### 2. Verificar Túnel

```powershell
# Desde cualquier máquina con internet
curl https://abc123-def-456.trycloudflare.com/health
```

### 3. Verificar Backend en Render

```powershell
# El backend debe poder descargar archivos
curl https://tu-backend.onrender.com/api/adjuntos/visita/123
```

### 4. Probar descarga de archivo

```powershell
# Ajustar ruta a un archivo real
curl "https://abc123-def-456.trycloudflare.com/file?path=E:\adjuntos\ejemplo.pdf"
```

---

## 🔄 Actualizar URL del Túnel

**Cada vez que reinicies el túnel, la URL cambia:**

### Proceso:

```powershell
# 1. Reiniciar túnel
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
.\start-sistema-completo.bat

# 2. Copiar nueva URL del túnel
# Ejemplo: https://xyz789.trycloudflare.com

# 3. Actualizar Render
# Dashboard → Backend → Environment
# FILE_SERVER_URL = https://xyz789.trycloudflare.com
# Save

# 4. Actualizar Vercel
# Dashboard → Frontend → Settings → Environment Variables
# NEXT_PUBLIC_FILE_SERVER_URL = https://xyz789.trycloudflare.com
# Redeploy
```

---

## 🎯 Ventajas de esta Solución

✅ **No requiere Node.js** - Solo PowerShell (ya instalado)  
✅ **No requiere instalaciones** - Cloudflared es portable  
✅ **Usa infraestructura existente** - SQL Server + E:\  
✅ **Backend en la nube** - Render/Railway  
✅ **Túnel gratuito** - Cloudflare  
✅ **Fácil de implementar** - Solo copiar archivos  

---

## 🔧 Crear Servicio de Windows (Opcional)

Para que el sistema inicie automáticamente con Windows:

### Usando NSSM (Non-Sucking Service Manager)

```powershell
# 1. Descargar NSSM desde: https://nssm.cc/download

# 2. Crear servicio para el túnel
nssm install iMedicTunnel "C:\...\cloudflared.exe" "tunnel --url http://localhost:3002"

# 3. Crear servicio para el file server
nssm install iMedicFileServer "powershell.exe" "-ExecutionPolicy Bypass -File C:\...\file-server.ps1"

# 4. Configurar inicio automático
nssm set iMedicTunnel Start SERVICE_AUTO_START
nssm set iMedicFileServer Start SERVICE_AUTO_START

# 5. Iniciar servicios
nssm start iMedicTunnel
nssm start iMedicFileServer
```

---

## ⚠️ Consideraciones

### Túnel Gratuito de Cloudflare

**Desventaja:**
- ❌ URL cambia cada vez que se reinicia

**Solución:**
- ✅ Usar ngrok con plan de pago (~$8/mes) para URL fija
- ✅ Crear servicio de Windows para que no se reinicie

### Alternativa: ngrok con URL Fija

```powershell
# Requiere cuenta de pago
ngrok http 3002 --subdomain=imedic-files

# URL fija: https://imedic-files.ngrok.io
```

---

## 🆘 Troubleshooting

### Error: "No se puede ejecutar scripts"

```powershell
# Habilitar ejecución de scripts PowerShell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Error: "Puerto 3002 ya está en uso"

```powershell
# Encontrar proceso
netstat -ano | findstr :3002

# Matar proceso (reemplazar PID)
taskkill /PID 12345 /F
```

### Error: "Archivo no encontrado"

**Verificar:**
1. La ruta en SQL es correcta
2. El archivo existe en E:\adjuntos\
3. Permisos de lectura del archivo
4. Mapeo de unidades (D:\ → E:\) en `file-server.ps1`

### Túnel no accesible desde internet

**Verificar:**
1. Cloudflared está corriendo
2. Firewall de Windows permite conexiones
3. URL del túnel es correcta

---

## 📝 Resumen de Archivos

```
C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer\
├── file-server.ps1              # Servidor HTTP PowerShell
├── start-file-server.bat        # Inicia servidor
├── start-sistema-completo.bat   # Inicia todo
├── start-tunnel.bat             # Solo túnel
└── cloudflared.exe              # Ejecutable túnel (opcional)
```

---

## 📝 Resumen de Comandos

```powershell
# En la máquina SQL Server
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# Iniciar todo
.\start-sistema-completo.bat

# Copiar URL del túnel y configurar en:
# - Render: FILE_SERVER_URL = https://abc123.trycloudflare.com
# - Vercel: NEXT_PUBLIC_FILE_SERVER_URL = https://abc123.trycloudflare.com
```

---

## 🎯 Alternativa Recomendada a Largo Plazo

### Migrar a Azure Blob Storage

**Ventajas:**
- ✅ No requiere túnel
- ✅ No requiere servidor local
- ✅ URLs permanentes
- ✅ Escalable
- ✅ Costo: ~$2-3 USD/mes por 100GB

**Proceso:**
1. Crear Azure Storage Account
2. Migrar archivos de E:\ a Blob
3. Actualizar rutas en SQL
4. Modificar backend para usar Azure SDK

---

**Última actualización:** 2026-03-26  
**Versión:** 1.0 (Solución sin Node.js)
