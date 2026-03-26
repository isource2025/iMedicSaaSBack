# Configuración de Túnel para Sistema de Adjuntos - iMedicWs

## 📋 Resumen del Sistema

El sistema de adjuntos de iMedicWs almacena archivos localmente en un servidor on-premise y guarda las rutas en SQL Server (tabla `imPedidosEstudiosAdjuntos`). 

**Arquitectura actual:**
- **Backend:** Render/Railway (remoto en la nube)
- **Base de datos:** SQL Server remoto
- **Archivos adjuntos:** Servidor local on-premise (E:\adjuntos)

**Para que Vercel y Render puedan acceder a estos archivos locales, necesitamos:**

1. **Servidor HTTP de archivos** corriendo en la máquina local (donde están los archivos)
2. **Túnel permanente** (ngrok/cloudflare) que exponga el file server local a internet
3. **Variables de entorno** configuradas en Render y Vercel apuntando al túnel

---

## 🔧 PASO 1: Crear Servidor HTTP de Archivos (Máquina Local)

### 1.1 Crear carpeta para el File Server

```powershell
# En la máquina local donde están los archivos
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA
mkdir FileServer
cd FileServer

# Inicializar proyecto Node.js
npm init -y
npm install express cors
```

### 1.2 Crear archivo `file-server.js`

```javascript
// file-server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.FILE_SERVER_PORT || 3002;

// Habilitar CORS para que Vercel pueda acceder
app.use(cors());

/**
 * Normaliza la ruta del archivo (mapea D:\ y F:\ a E:\)
 */
function normalizarRuta(rutaOriginal) {
  if (!rutaOriginal) return rutaOriginal;
  
  let ruta = rutaOriginal;
  
  // Mapear D:\ a E:\
  if (ruta.startsWith('D:\\')) {
    ruta = ruta.replace(/^D:\\/, 'E:\\');
  }
  
  // Mapear F:\ a E:\
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

    // Normalizar la ruta
    const normalizedPath = normalizarRuta(filePath);
    
    console.log(`📂 Solicitando archivo: ${filePath}`);
    if (normalizedPath !== filePath) {
      console.log(`🔄 Ruta normalizada: ${normalizedPath}`);
    }

    // Verificar que el archivo existe
    if (!fs.existsSync(normalizedPath)) {
      console.error(`❌ Archivo no encontrado: ${normalizedPath}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Archivo no encontrado',
        path: normalizedPath
      });
    }

    // Determinar tipo MIME
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
    
    // Configurar headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(normalizedPath)}"`);
    
    // Enviar archivo
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
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor de archivos corriendo en puerto ${PORT}`);
  console.log(`📁 Listo para servir archivos desde rutas locales`);
});
```

### 1.3 Agregar script en `package.json` del FileServer

```json
{
  "name": "imedic-file-server",
  "version": "1.0.0",
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

## 🌐 PASO 2: Configurar Túnel Permanente con Cloudflare

### 2.1 Instalar Cloudflare Tunnel (cloudflared)

**Windows:**
```powershell
# Descargar desde: https://github.com/cloudflare/cloudflared/releases
# O usar winget:
winget install --id Cloudflare.cloudflared
```

### 2.2 Crear archivo `start-tunnel-permanent.bat` en la carpeta FileServer

```batch
@echo off
echo ========================================
echo Iniciando Cloudflare Tunnel Permanente
echo iMedicWs File Server - Puerto 3002
echo ========================================
echo.

REM Iniciar túnel en puerto 3002 (file server)
cloudflared tunnel --url http://localhost:3002

echo.
echo IMPORTANTE: Copia la URL que aparece arriba
echo Ejemplo: https://abc123.trycloudflare.com
echo.
echo Esta URL debe configurarse en:
echo 1. Render - Variable FILE_SERVER_URL
echo 2. Vercel - Variable NEXT_PUBLIC_FILE_SERVER_URL
echo.
pause
```

### 2.3 Alternativa: Usar ngrok

**Crear `start-tunnel-permanent.bat` con ngrok:**

```batch
@echo off
echo ========================================
echo Iniciando ngrok Tunnel Permanente
echo ========================================
echo.

REM Asegúrate de tener ngrok instalado y autenticado
ngrok http 3002 --log=stdout

pause
```

---

## ⚙️ PASO 3: Configurar Variables de Entorno

### 3.1 Variables en Render (Backend)

**Ir a:** Render Dashboard → Tu servicio backend → Environment

**Agregar/Actualizar:**
```
FILE_SERVER_URL = https://abc123.trycloudflare.com
```

**Nota:** Esta URL viene del túnel que iniciaste en el PASO 2.

### 3.2 Variables en Vercel (Frontend)

**Ir a:** Vercel Dashboard → iMedicWSFront → Settings → Environment Variables

**Agregar/Actualizar:**
```
NEXT_PUBLIC_FILE_SERVER_URL = https://abc123.trycloudflare.com
```

### 3.3 Archivo `.env` local (solo para referencia)

Crear `.env` en la carpeta FileServer:

```env
# Puerto del servidor de archivos
FILE_SERVER_PORT=3002

# URL del túnel (actualizar después de iniciar cloudflared)
TUNNEL_URL=https://abc123.trycloudflare.com
```

---

## 🚀 PASO 4: Comandos de Ejecución (Máquina Local)

### 4.1 Iniciar el File Server y Túnel

**IMPORTANTE:** Estos comandos se ejecutan en la **máquina local** donde están los archivos.

```powershell
# 1. Navegar a la carpeta del FileServer
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# 2. Iniciar el túnel permanente (Terminal 1)
.\start-tunnel-permanent.bat

# 3. Copiar la URL del túnel que aparece en la consola
# Ejemplo: https://abc123.trycloudflare.com
# ⚠️ IMPORTANTE: Guarda esta URL, la necesitarás para Render y Vercel

# 4. Iniciar el servidor de archivos (Terminal 2)
npm start
```

### 4.2 El Backend en Render

**No necesitas hacer nada localmente con el backend.** El backend ya está corriendo en Render.

Solo necesitas configurar la variable de entorno `FILE_SERVER_URL` en Render con la URL del túnel.

### 4.3 Script automatizado (opcional)

Crear `start-all.bat` en la carpeta FileServer:

```batch
@echo off
echo ========================================
echo Iniciando File Server iMedicWs
echo ========================================
echo.

echo [1/2] Iniciando Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3002"

echo [2/2] Esperando 5 segundos...
timeout /t 5 /nobreak

echo Iniciando File Server...
start "File Server" cmd /k "npm start"

echo.
echo ========================================
echo File Server iniciado
echo ========================================
echo.
echo SIGUIENTE PASO:
echo 1. Copia la URL del túnel de la ventana "Cloudflare Tunnel"
echo    Ejemplo: https://abc123.trycloudflare.com
echo.
echo 2. Configura en Render:
echo    Dashboard -^> Backend -^> Environment
echo    FILE_SERVER_URL = https://abc123.trycloudflare.com
echo.
echo 3. Configura en Vercel:
echo    Dashboard -^> iMedicWSFront -^> Settings -^> Environment Variables
echo    NEXT_PUBLIC_FILE_SERVER_URL = https://abc123.trycloudflare.com
echo.
pause
```

---

## ☁️ PASO 5: Configurar Render (Backend)

### 5.1 Acceder a Render Dashboard

1. Ir a https://dashboard.render.com/
2. Seleccionar tu servicio de **Backend** (iMedicWSBack)
3. Ir a **Environment**

### 5.2 Agregar/Actualizar Variable

```
FILE_SERVER_URL = https://abc123.trycloudflare.com
```

**Nota:** Reemplaza `abc123.trycloudflare.com` con la URL real de tu túnel.

### 5.3 Guardar y Redesplegar

- Click en **Save Changes**
- Render redesplegará automáticamente el backend

---

## ☁️ PASO 6: Configurar Vercel (Frontend)

### 6.1 Acceder a Vercel Dashboard

1. Ir a https://vercel.com/dashboard
2. Seleccionar el proyecto **iMedicWSFront**
3. Ir a **Settings** → **Environment Variables**

### 6.2 Agregar/Actualizar Variable

```
NEXT_PUBLIC_FILE_SERVER_URL = https://abc123.trycloudflare.com
```

### 6.3 Redesplegar Frontend

Después de actualizar las variables:
- Click en **Deployments**
- Click en los 3 puntos del último deployment
- Click en **Redeploy**

---

## 🔍 PASO 7: Verificación

### 7.1 Verificar File Server Local

```powershell
# Health check
curl http://localhost:3002/health

# Probar servir un archivo (ajustar ruta)
curl "http://localhost:3002/file?path=E:\adjuntos\archivo.pdf"
```

### 7.2 Verificar Túnel

```powershell
# Probar desde el túnel
curl "https://abc123.trycloudflare.com/health"
```

### 7.3 Verificar Backend en Render

```powershell
# Verificar que el backend puede acceder al file server
# Abrir en navegador o curl:
curl "https://tu-backend.onrender.com/api/adjuntos/visita/123"
```

### 7.4 Verificar desde Vercel

En el frontend, abrir DevTools y verificar que las peticiones a adjuntos funcionen correctamente.

---

## 📊 Alternativa: Agente SQL para Servir Archivos

### ¿Es viable crear un agente SQL?

**Respuesta corta: NO es recomendable**

**Razones:**

1. **Limitaciones de SQL Server:**
   - SQL Server puede leer archivos con `OPENROWSET(BULK...)` pero requiere permisos especiales
   - No puede servir archivos HTTP directamente
   - Requeriría CLR (Common Language Runtime) que es complejo y riesgoso

2. **Problemas de seguridad:**
   - Exponer SQL Server directamente a internet es un riesgo de seguridad
   - Los archivos podrían ser grandes (PDFs, imágenes) y afectar el rendimiento de SQL

3. **Mejor alternativa:**
   - **Túnel HTTP** (como el propuesto) es más simple, seguro y eficiente
   - **Migración a Cloud Storage** (Azure Blob, AWS S3) sería la solución ideal a largo plazo

---

## 🎯 Solución Recomendada a Largo Plazo

### Migrar a Azure Blob Storage

**Ventajas:**
- ✅ No requiere túnel permanente
- ✅ URLs públicas con SAS tokens
- ✅ Escalable y confiable
- ✅ Integración nativa con Azure SQL
- ✅ CDN para mejor rendimiento

**Pasos básicos:**
1. Crear Azure Storage Account
2. Crear container para adjuntos
3. Migrar archivos existentes
4. Actualizar tabla SQL con URLs de Blob
5. Modificar backend para usar Azure SDK

---

## 📝 Resumen de Comandos

### En la Máquina Local (donde están los archivos)

```powershell
# PASO 1: Navegar a la carpeta FileServer
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# PASO 2: Iniciar túnel (Terminal 1)
.\start-tunnel-permanent.bat
# Copiar la URL que aparece: https://abc123.trycloudflare.com

# PASO 3: Iniciar File Server (Terminal 2)
npm start
```

### En Render Dashboard (Backend)

```
1. Ir a: https://dashboard.render.com/
2. Seleccionar: iMedicWSBack
3. Environment → Agregar:
   FILE_SERVER_URL = https://abc123.trycloudflare.com
4. Save Changes (redespliega automáticamente)
```

### En Vercel Dashboard (Frontend)

```
1. Ir a: https://vercel.com/dashboard
2. Seleccionar: iMedicWSFront
3. Settings → Environment Variables → Agregar:
   NEXT_PUBLIC_FILE_SERVER_URL = https://abc123.trycloudflare.com
4. Deployments → Redeploy
```

---

## ⚠️ Consideraciones Importantes

1. **Túnel gratuito de Cloudflare:**
   - La URL cambia cada vez que se reinicia
   - Hay que actualizar las variables de entorno cada vez

2. **Túnel permanente con ngrok:**
   - Requiere cuenta de pago para URL fija
   - Más estable para producción

3. **Rendimiento:**
   - El túnel agrega latencia
   - Considerar migrar a cloud storage para producción

4. **Seguridad:**
   - Validar siempre las rutas de archivos
   - Implementar autenticación en el servidor de archivos
   - No exponer rutas sensibles del sistema

---

## 🆘 Troubleshooting

### Problema: "Archivo no encontrado"
- Verificar que la ruta en SQL sea correcta
- Verificar mapeo de unidades (D:\ → E:\)
- Verificar permisos de lectura del archivo

### Problema: "Túnel no accesible"
- Verificar que cloudflared esté corriendo
- Verificar firewall de Windows
- Probar con `curl` desde otra máquina

### Problema: "CORS error en Vercel"
- Verificar que el servidor de archivos tenga CORS habilitado
- Verificar que la URL del túnel esté correcta en Vercel

---

**Autor:** Sistema iMedicWs  
**Fecha:** 2026-03-26  
**Versión:** 1.0
