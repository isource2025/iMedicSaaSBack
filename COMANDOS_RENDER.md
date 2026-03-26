# 🚀 Comandos Rápidos - Sistema de Adjuntos con Backend en Render

## 📋 Arquitectura

- **Backend:** Render/Railway (remoto)
- **Frontend:** Vercel (remoto)
- **File Server:** Máquina local (donde están los archivos)
- **Túnel:** Cloudflare/ngrok (expone file server)

---

## ⚡ Comandos para Iniciar el Sistema

### En la Máquina Local (donde están los archivos)

```powershell
# PASO 1: Navegar a la carpeta FileServer
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer

# PASO 2: Iniciar el túnel (Terminal 1)
.\start-tunnel-permanent.bat

# Resultado esperado:
# Your quick Tunnel has been created! Visit it at:
# https://abc123-def-456.trycloudflare.com
#
# ⚠️ IMPORTANTE: Copia esta URL

# PASO 3: Iniciar File Server (Terminal 2)
npm start

# Resultado esperado:
# 🚀 Servidor de archivos corriendo en puerto 3002
# 📁 Listo para servir archivos desde rutas locales
```

---

## ☁️ Configurar Render (Backend)

### Opción 1: Dashboard Web

```
1. Ir a: https://dashboard.render.com/
2. Seleccionar: iMedicWSBack (tu servicio backend)
3. Click en: Environment (menú izquierdo)
4. Buscar o agregar: FILE_SERVER_URL
5. Valor: https://abc123-def-456.trycloudflare.com
6. Click: Save Changes
7. Render redesplegará automáticamente
```

### Opción 2: Render CLI (opcional)

```powershell
# Instalar Render CLI
npm install -g render-cli

# Login
render login

# Actualizar variable
render env set FILE_SERVER_URL=https://abc123-def-456.trycloudflare.com
```

---

## ☁️ Configurar Vercel (Frontend)

### Opción 1: Dashboard Web

```
1. Ir a: https://vercel.com/dashboard
2. Seleccionar: iMedicWSFront
3. Click en: Settings → Environment Variables
4. Buscar o agregar: NEXT_PUBLIC_FILE_SERVER_URL
5. Valor: https://abc123-def-456.trycloudflare.com
6. Click: Save
7. Ir a: Deployments
8. Click en los 3 puntos del último deployment
9. Click: Redeploy
```

### Opción 2: Vercel CLI

```powershell
# Instalar Vercel CLI (si no lo tienes)
npm install -g vercel

# Login
vercel login

# Actualizar variable
vercel env rm NEXT_PUBLIC_FILE_SERVER_URL production
vercel env add NEXT_PUBLIC_FILE_SERVER_URL production
# Cuando pregunte el valor: https://abc123-def-456.trycloudflare.com

# Redesplegar
vercel --prod
```

---

## 🧪 Verificación

### 1. Verificar File Server Local

```powershell
# Health check
curl http://localhost:3002/health

# Respuesta esperada:
# {"success":true,"status":"OK","timestamp":"2026-03-26T..."}
```

### 2. Verificar Túnel

```powershell
# Reemplazar con tu URL del túnel
curl https://abc123-def-456.trycloudflare.com/health

# Respuesta esperada (igual que arriba):
# {"success":true,"status":"OK","timestamp":"2026-03-26T..."}
```

### 3. Verificar Backend en Render

```powershell
# Verificar que el backend está corriendo
curl https://tu-backend.onrender.com/api/health

# O abrir en navegador:
# https://tu-backend.onrender.com
```

### 4. Probar descarga de adjunto

```powershell
# Desde el túnel (ajustar ruta a un archivo real)
curl "https://abc123-def-456.trycloudflare.com/file?path=E:\adjuntos\ejemplo.pdf"

# Debería descargar el archivo
```

---

## 🔄 Actualizar URL del Túnel

**⚠️ IMPORTANTE:** Cada vez que reinicies el túnel, la URL cambia.

### Proceso completo:

```powershell
# 1. Reiniciar túnel
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
.\start-tunnel-permanent.bat

# 2. Copiar nueva URL
# Ejemplo: https://xyz789-abc-123.trycloudflare.com

# 3. Actualizar Render
# Dashboard → Backend → Environment → FILE_SERVER_URL
# Pegar nueva URL → Save

# 4. Actualizar Vercel
# Dashboard → Frontend → Settings → Environment Variables
# NEXT_PUBLIC_FILE_SERVER_URL → Pegar nueva URL → Save
# Deployments → Redeploy

# 5. Verificar
curl https://xyz789-abc-123.trycloudflare.com/health
```

---

## 🛑 Detener el Sistema

```powershell
# En cada terminal, presionar:
Ctrl + C

# O cerrar las ventanas directamente
```

---

## 📁 Estructura de Archivos en Máquina Local

```
C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer\
├── file-server.js              # Servidor HTTP de archivos
├── start-tunnel-permanent.bat  # Script para iniciar túnel
├── start-all.bat               # Script para iniciar todo
├── package.json                # Dependencias Node.js
└── .env                        # Variables de entorno (opcional)
```

---

## 🆘 Troubleshooting

### Error: "cloudflared no se reconoce como comando"

```powershell
# Instalar cloudflared
winget install --id Cloudflare.cloudflared

# O descargar desde:
# https://github.com/cloudflare/cloudflared/releases
```

### Error: "Cannot find module 'express'"

```powershell
cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
npm install
```

### Error: "Puerto 3002 ya está en uso"

```powershell
# Encontrar proceso usando el puerto
netstat -ano | findstr :3002

# Matar proceso (reemplazar 12345 con el PID real)
taskkill /PID 12345 /F
```

### Error: "Archivo no encontrado" al descargar adjunto

**Verificar:**
1. La ruta en SQL es correcta
2. El mapeo de unidades (D:\ → E:\) es correcto en `file-server.js`
3. El archivo existe físicamente en E:\
4. Permisos de lectura del archivo

### Error: "Túnel no accesible desde internet"

```powershell
# Verificar que cloudflared está corriendo
# Verificar firewall de Windows
# Probar con curl desde otra máquina:
curl https://tu-tunnel-url.trycloudflare.com/health
```

### Backend en Render no puede acceder al túnel

**Verificar:**
1. Variable `FILE_SERVER_URL` está configurada en Render
2. URL del túnel es correcta (sin espacios, con https://)
3. Túnel está corriendo en la máquina local
4. Redesplegar backend después de cambiar variable

---

## 💡 Tips y Mejores Prácticas

### 1. Mantener el túnel corriendo

```powershell
# Usar Task Scheduler de Windows para auto-iniciar
# O crear un servicio de Windows con NSSM
```

### 2. Monitorear el file server

```powershell
# Agregar logs en file-server.js
console.log(`📂 Archivo solicitado: ${filePath}`);
console.log(`✅ Archivo enviado: ${normalizedPath}`);
```

### 3. URL fija con ngrok (requiere cuenta de pago)

```powershell
# Instalar ngrok
# Autenticar: ngrok authtoken TU_TOKEN

# Crear túnel con subdominio fijo
ngrok http 3002 --subdomain=imedic-files

# URL fija: https://imedic-files.ngrok.io
```

---

## 📞 Documentación Adicional

- **Arquitectura completa:** `ARQUITECTURA_RENDER.md`
- **Setup detallado:** `SETUP_TUNNEL_ADJUNTOS.md`
- **Código del servidor:** `file-server.js`

---

**Última actualización:** 2026-03-26  
**Versión:** 1.0 (Arquitectura con Render)
