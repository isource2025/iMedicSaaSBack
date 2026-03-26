# 🎯 Solución Final: Túnel + SQL Server + Backend en Render

## 📋 Arquitectura

**Componentes:**
1. **SQL Server + File Server** → Misma máquina on-premise
2. **Túnel Cloudflare** → Expone File Server a internet
3. **Backend en Render** → Accede a archivos vía túnel
4. **Frontend en Vercel** → Accede a archivos vía túnel

**Flujo:**
```
Usuario → Vercel → Túnel → File Server (máquina SQL) → E:\adjuntos\
Backend Render → Túnel → File Server (máquina SQL) → E:\adjuntos\
```

---

## 🚀 PASO 1: Instalar File Server en la Máquina de SQL Server

### En la máquina donde está SQL Server (C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\)

```powershell
# 1. Crear carpeta FileServer
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA
mkdir FileServer
cd FileServer

# 2. Inicializar proyecto Node.js
npm init -y

# 3. Instalar dependencias
npm install express cors
```

### Crear archivo `file-server.js`

```javascript
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.FILE_SERVER_PORT || 3002;

app.use(cors());

/**
 * Normaliza la ruta del archivo (mapea D:\ y F:\ a E:\)
 */
function normalizarRuta(rutaOriginal) {
  if (!rutaOriginal) return rutaOriginal;
  
  let ruta = rutaOriginal;
  
  if (ruta.startsWith('D:\\')) {
    ruta = ruta.replace(/^D:\\/, 'E:\\');
  }
  
  if (ruta.startsWith('F:\\')) {
    ruta = ruta.replace(/^F:\\/, 'E:\\');
  }
  
  return ruta;
}

/**
 * GET /file?path=E:\ruta\al\archivo.pdf
 * Sirve un archivo desde el sistema de archivos local
 */
app.get('/file', (req, res) => {
  try {
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).json({ 
        success: false, 
        error: 'Parámetro path es requerido' 
      });
    }

    const normalizedPath = normalizarRuta(filePath);
    
    console.log(`📂 Solicitando archivo: ${filePath}`);
    if (normalizedPath !== filePath) {
      console.log(`🔄 Ruta normalizada: ${normalizedPath}`);
    }

    if (!fs.existsSync(normalizedPath)) {
      console.error(`❌ Archivo no encontrado: ${normalizedPath}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Archivo no encontrado',
        path: normalizedPath
      });
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(normalizedPath)}"`);
    
    const fileStream = fs.createReadStream(normalizedPath);
    fileStream.pipe(res);
    
    console.log(`✅ Archivo enviado: ${normalizedPath}`);
    
  } catch (error) {
    console.error('❌ Error al servir archivo:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error al servir archivo',
      details: error.message
    });
  }
});

/**
 * GET /health
 * Health check del servidor
 */
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'OK',
    timestamp: new Date().toISOString(),
    server: 'iMedic File Server'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 iMedic File Server corriendo en puerto ${PORT}`);
  console.log(`📁 Listo para servir archivos desde E:\\adjuntos`);
  console.log(`🔗 Endpoints disponibles:`);
  console.log(`   - GET /health`);
  console.log(`   - GET /file?path=E:\\adjuntos\\archivo.pdf`);
});
```

### Crear `package.json`

```json
{
  "name": "imedic-file-server",
  "version": "1.0.0",
  "description": "Servidor de archivos para iMedicWs",
  "main": "file-server.js",
  "scripts": {
    "start": "node file-server.js",
    "dev": "nodemon file-server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5"
  }
}
```

---

## 🌐 PASO 2: Configurar Túnel Cloudflare

### Instalar cloudflared

```powershell
# Opción 1: Con winget
winget install --id Cloudflare.cloudflared

# Opción 2: Descargar desde
# https://github.com/cloudflare/cloudflared/releases
```

### Crear `start-tunnel-permanent.bat`

```batch
@echo off
echo ========================================
echo iMedic File Server - Cloudflare Tunnel
echo ========================================
echo.
echo Iniciando tunel en puerto 3002...
echo.

cloudflared tunnel --url http://localhost:3002

echo.
echo IMPORTANTE: Copia la URL que aparece arriba
echo Ejemplo: https://abc123-def-456.trycloudflare.com
echo.
echo Esta URL debe configurarse en:
echo 1. Render (Backend) - FILE_SERVER_URL
echo 2. Vercel (Frontend) - NEXT_PUBLIC_FILE_SERVER_URL
echo.
pause
```

### Crear `start-all.bat` (Script automatizado)

```batch
@echo off
echo ========================================
echo Iniciando iMedic File Server
echo ========================================
echo.

echo [1/2] Iniciando Cloudflare Tunnel...
start "iMedic Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3002"

echo [2/2] Esperando 5 segundos...
timeout /t 5 /nobreak

echo Iniciando File Server...
start "iMedic File Server" cmd /k "npm start"

echo.
echo ========================================
echo Sistema iniciado
echo ========================================
echo.
echo VENTANAS ABIERTAS:
echo   1. iMedic Tunnel - Copia la URL del tunel
echo   2. iMedic File Server - Puerto 3002
echo.
echo SIGUIENTE PASO:
echo   Configura la URL del tunel en Render y Vercel
echo.
pause
```

---

## ⚙️ PASO 3: Configurar Variables de Entorno

### En Render (Backend)

```
1. https://dashboard.render.com/
2. Seleccionar: iMedicWSBack
3. Environment → Agregar/Actualizar:
   
   FILE_SERVER_URL = https://abc123-def-456.trycloudflare.com

4. Save Changes (redespliega automáticamente)
```

### En Vercel (Frontend)

```
1. https://vercel.com/dashboard
2. Seleccionar: iMedicWSFront
3. Settings → Environment Variables → Agregar/Actualizar:
   
   NEXT_PUBLIC_FILE_SERVER_URL = https://abc123-def-456.trycloudflare.com

4. Deployments → Redeploy
```

---

## 🚀 PASO 4: Iniciar el Sistema

### En la máquina de SQL Server

```powershell
# Navegar a la carpeta
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# Opción 1: Script automatizado (recomendado)
.\start-all.bat

# Opción 2: Manual
# Terminal 1:
.\start-tunnel-permanent.bat

# Terminal 2:
npm start
```

### Copiar URL del túnel

Cuando ejecutes el túnel, verás algo como:
```
Your quick Tunnel has been created! Visit it at:
https://abc123-def-456.trycloudflare.com
```

**⚠️ IMPORTANTE:** Copia esta URL y úsala en Render y Vercel.

---

## 🔍 PASO 5: Verificación

### 1. Verificar File Server Local

```powershell
curl http://localhost:3002/health

# Respuesta esperada:
# {"success":true,"status":"OK","timestamp":"...","server":"iMedic File Server"}
```

### 2. Verificar Túnel

```powershell
curl https://abc123-def-456.trycloudflare.com/health

# Debe devolver lo mismo que arriba
```

### 3. Verificar Backend en Render

```powershell
# El backend debe poder acceder al túnel
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

```powershell
# 1. Reiniciar túnel
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
.\start-tunnel-permanent.bat

# 2. Copiar nueva URL
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

✅ **Un solo servidor on-premise** (donde ya está SQL Server)  
✅ **Backend en la nube** (Render/Railway)  
✅ **No requiere migrar archivos**  
✅ **Usa la infraestructura existente**  
✅ **Túnel gratuito**  
✅ **Fácil de implementar**  

---

## ⚠️ Consideraciones

### Túnel gratuito de Cloudflare
- ❌ URL cambia cada vez que se reinicia
- ✅ Solución: Usar ngrok con plan de pago para URL fija

### Alternativa: ngrok con URL fija

```powershell
# Requiere cuenta de pago (~$8/mes)
ngrok http 3002 --subdomain=imedic-files

# URL fija: https://imedic-files.ngrok.io
```

### Mantener el túnel corriendo

**Opción 1: Crear servicio de Windows**

```powershell
# Instalar NSSM (Non-Sucking Service Manager)
# Descargar desde: https://nssm.cc/download

# Crear servicio para el túnel
nssm install iMedicTunnel "C:\Program Files\cloudflared\cloudflared.exe" "tunnel --url http://localhost:3002"

# Crear servicio para el file server
nssm install iMedicFileServer "C:\Program Files\nodejs\node.exe" "C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer\file-server.js"

# Iniciar servicios
nssm start iMedicTunnel
nssm start iMedicFileServer
```

**Opción 2: Task Scheduler**

Configurar tareas que se ejecuten al iniciar Windows.

---

## 📝 Resumen de Comandos

```powershell
# En la máquina de SQL Server
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# Iniciar todo
.\start-all.bat

# Copiar URL del túnel y configurar en:
# - Render: FILE_SERVER_URL
# - Vercel: NEXT_PUBLIC_FILE_SERVER_URL
```

---

**Última actualización:** 2026-03-26  
**Versión:** 1.0 (Solución Final con Túnel + SQL)
