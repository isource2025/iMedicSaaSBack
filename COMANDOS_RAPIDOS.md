# 🚀 Comandos Rápidos - Sistema de Adjuntos iMedicWs

## 📋 Resumen

Este documento contiene todos los comandos necesarios para configurar y ejecutar el sistema de túnel para servir adjuntos desde una base de datos remota.

---

## ⚡ Inicio Rápido (Opción Automática)

```powershell
# Navegar a la carpeta del Backend
cd C:\Users\iSource\Desktop\iMedicWs\iMedicWSBack

# Ejecutar script que inicia todo
.\start-all.bat
```

Este script abrirá 3 ventanas:
1. **Cloudflare Tunnel** - Copia la URL que aparece aquí
2. **File Server** - Puerto 3002
3. **Backend API** - Puerto 3001

---

## 🔧 Inicio Manual (Paso a Paso)

### PASO 1: Navegar a la carpeta
```powershell
cd C:\Users\iSource\Desktop\iMedicWs\iMedicWSBack
```

### PASO 2: Iniciar el túnel (Terminal 1)
```powershell
.\start-tunnel-permanent.bat
```
**Resultado esperado:**
```
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://abc123-def-456.trycloudflare.com
```
**⚠️ IMPORTANTE:** Copia esta URL, la necesitarás en los siguientes pasos.

### PASO 3: Actualizar archivo .env
```powershell
# Editar .env con tu editor favorito
notepad .env

# O crear uno nuevo desde el ejemplo
copy .env.example .env
notepad .env
```

**Contenido del .env:**
```env
# Database Configuration
DB_SERVER=tu-servidor-remoto.database.windows.net
DB_PORT=1433
DB_USER=tu-usuario
DB_PASSWORD=tu-password
DB_DATABASE=iMedicDB

# Server Configuration
PORT=3001

# File Server Configuration
FILE_SERVER_URL=https://abc123-def-456.trycloudflare.com
FILE_SERVER_PORT=3002

# Tunnel URL (para referencia)
TUNNEL_URL=https://abc123-def-456.trycloudflare.com
```

### PASO 4: Iniciar File Server (Terminal 2)
```powershell
npm run file-server
```
**Resultado esperado:**
```
🚀 Servidor de archivos corriendo en puerto 3002
📁 Listo para servir archivos desde rutas locales
```

### PASO 5: Iniciar Backend (Terminal 3)
```powershell
npm run dev
```
**Resultado esperado:**
```
🚀 Servidor corriendo en puerto 3001
✅ Conectado a SQL Server
```

---

## ☁️ Configurar Vercel

### Opción 1: Desde el Dashboard Web

1. Ir a https://vercel.com/dashboard
2. Seleccionar proyecto **iMedicWSFront**
3. Ir a **Settings** → **Environment Variables**
4. Agregar/Actualizar:
   ```
   NEXT_PUBLIC_FILE_SERVER_URL = https://abc123-def-456.trycloudflare.com
   ```
5. Click en **Save**
6. Ir a **Deployments** → Click en los 3 puntos → **Redeploy**

### Opción 2: Desde Vercel CLI

```powershell
# Instalar Vercel CLI (si no lo tienes)
npm install -g vercel

# Login
vercel login

# Agregar variable de entorno
vercel env add NEXT_PUBLIC_FILE_SERVER_URL

# Cuando te pregunte el valor, pegar:
# https://abc123-def-456.trycloudflare.com

# Redesplegar
vercel --prod
```

---

## 🧪 Verificación

### 1. Verificar File Server Local
```powershell
# Health check
curl http://localhost:3002/health

# Debería devolver:
# {"success":true,"status":"OK","timestamp":"2026-03-26T..."}
```

### 2. Verificar Túnel
```powershell
# Reemplazar con tu URL del túnel
curl https://abc123-def-456.trycloudflare.com/health

# Debería devolver lo mismo que arriba
```

### 3. Verificar Backend
```powershell
curl http://localhost:3001/api/health

# O abrir en navegador:
# http://localhost:3001
```

### 4. Probar servir un archivo (ejemplo)
```powershell
# Ajustar la ruta a un archivo real en tu sistema
curl "http://localhost:3002/file?path=E:\adjuntos\ejemplo.pdf"

# O desde el túnel:
curl "https://abc123-def-456.trycloudflare.com/file?path=E:\adjuntos\ejemplo.pdf"
```

---

## 🔄 Actualizar URL del Túnel

**Cada vez que reinicies el túnel, la URL cambia. Sigue estos pasos:**

### 1. Obtener nueva URL
```powershell
# Iniciar túnel
.\start-tunnel-permanent.bat

# Copiar la URL que aparece (ej: https://xyz789.trycloudflare.com)
```

### 2. Actualizar .env
```powershell
notepad .env

# Cambiar:
FILE_SERVER_URL=https://xyz789.trycloudflare.com
TUNNEL_URL=https://xyz789.trycloudflare.com
```

### 3. Reiniciar Backend
```powershell
# Detener el backend (Ctrl+C en la terminal)
# Volver a iniciar:
npm run dev
```

### 4. Actualizar Vercel
```powershell
# Opción A: Dashboard web (ver arriba)

# Opción B: CLI
vercel env rm NEXT_PUBLIC_FILE_SERVER_URL production
vercel env add NEXT_PUBLIC_FILE_SERVER_URL
# Pegar nueva URL: https://xyz789.trycloudflare.com
vercel --prod
```

---

## 🛑 Detener Todo

```powershell
# En cada terminal, presionar:
Ctrl + C

# O cerrar las ventanas directamente
```

---

## 📊 Estructura de Archivos

```
iMedicWSBack/
├── file-server.js              # Servidor HTTP de archivos
├── start-tunnel-permanent.bat  # Script para iniciar túnel
├── start-all.bat               # Script para iniciar todo
├── .env                        # Variables de entorno
├── .env.example                # Ejemplo de configuración
├── SETUP_TUNNEL_ADJUNTOS.md    # Documentación completa
└── COMANDOS_RAPIDOS.md         # Este archivo
```

---

## ⚠️ Notas Importantes

### Túnel Cloudflare Gratuito
- ✅ **Ventaja:** Gratis, fácil de usar
- ❌ **Desventaja:** URL cambia cada vez que se reinicia
- 💡 **Solución:** Usar ngrok con cuenta de pago para URL fija

### Alternativa: ngrok con URL Fija

```powershell
# 1. Instalar ngrok
# Descargar desde: https://ngrok.com/download

# 2. Autenticar (requiere cuenta)
ngrok authtoken TU_TOKEN_AQUI

# 3. Crear túnel con subdominio fijo (requiere plan de pago)
ngrok http 3002 --subdomain=imedic-files

# URL fija: https://imedic-files.ngrok.io
```

### Seguridad

**⚠️ IMPORTANTE:** El servidor de archivos actual NO tiene autenticación. Para producción, considera:

1. Agregar autenticación con tokens
2. Validar que solo se sirvan archivos de directorios permitidos
3. Implementar rate limiting
4. Usar HTTPS con certificados válidos

---

## 🆘 Troubleshooting

### Error: "cloudflared no se reconoce como comando"

**Solución:**
```powershell
# Instalar cloudflared
winget install --id Cloudflare.cloudflared

# O descargar desde:
# https://github.com/cloudflare/cloudflared/releases
```

### Error: "Cannot find module 'express'"

**Solución:**
```powershell
npm install
```

### Error: "Puerto 3002 ya está en uso"

**Solución:**
```powershell
# Encontrar proceso usando el puerto
netstat -ano | findstr :3002

# Matar proceso (reemplazar PID)
taskkill /PID 12345 /F
```

### Error: "Archivo no encontrado" al descargar adjunto

**Verificar:**
1. La ruta en SQL es correcta
2. El mapeo de unidades (D:\ → E:\) es correcto
3. El archivo existe físicamente
4. Permisos de lectura del archivo

---

## 📞 Contacto

Para más información, consultar:
- **Documentación completa:** `SETUP_TUNNEL_ADJUNTOS.md`
- **Código del servidor:** `file-server.js`
- **Controlador de adjuntos:** `src/controllers/adjuntos.controller.js`

---

**Última actualización:** 2026-03-26  
**Versión:** 1.0
