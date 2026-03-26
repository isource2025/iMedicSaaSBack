# 🏗️ Arquitectura del Sistema de Adjuntos con Backend en Render

## 📊 Diagrama de Arquitectura

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Vercel    │────────>│  Render Backend  │────────>│ SQL Server      │
│  (Frontend) │  HTTPS  │  (Node.js API)   │  HTTPS  │  (Remoto)       │
└─────────────┘         └──────────────────┘         └─────────────────┘
       │                         │
       │                         │
       │                         ▼
       │                  ┌──────────────────┐
       └─────────────────>│ Cloudflare Tunnel│
                   HTTPS  │ (Público)        │
                          └──────────────────┘
                                  │
                                  ▼
                          ┌──────────────────┐
                          │  File Server     │
                          │  (Máquina Local) │
                          │  Puerto 3002     │
                          └──────────────────┘
                                  │
                                  ▼
                          ┌──────────────────┐
                          │  E:\adjuntos\    │
                          │  (Archivos)      │
                          └──────────────────┘
```

## 🎯 Componentes del Sistema

### 1. **Frontend (Vercel)**
- **Ubicación:** Vercel (Cloud)
- **Función:** Interfaz de usuario
- **Acceso a archivos:** Directo vía túnel
- **Variable de entorno:** `NEXT_PUBLIC_FILE_SERVER_URL`

### 2. **Backend (Render/Railway)**
- **Ubicación:** Render (Cloud)
- **Función:** API REST, lógica de negocio
- **Acceso a archivos:** Vía túnel
- **Variable de entorno:** `FILE_SERVER_URL`

### 3. **Base de Datos (SQL Server)**
- **Ubicación:** Servidor remoto
- **Función:** Almacena rutas de archivos en `imPedidosEstudiosAdjuntos`
- **Conexión:** Desde Render vía HTTPS

### 4. **File Server (Máquina Local)**
- **Ubicación:** Servidor on-premise
- **Función:** Sirve archivos desde rutas locales
- **Puerto:** 3002
- **Acceso:** Solo vía túnel

### 5. **Túnel (Cloudflare/ngrok)**
- **Función:** Expone File Server local a internet
- **URL:** Dinámica (cambia al reiniciar)
- **Protocolo:** HTTPS

---

## 🚀 Flujo de Descarga de Adjuntos

### Opción A: Usuario descarga desde Vercel

```
1. Usuario click en "Descargar adjunto" en Vercel
2. Frontend hace GET a: https://abc123.trycloudflare.com/file?path=E:\adjuntos\archivo.pdf
3. Túnel redirige a: http://localhost:3002/file?path=E:\adjuntos\archivo.pdf
4. File Server lee el archivo del disco local
5. File Server envía el archivo al usuario
```

### Opción B: Backend procesa adjunto

```
1. Frontend solicita adjunto al Backend en Render
2. Backend hace GET a: https://abc123.trycloudflare.com/file?path=E:\adjuntos\archivo.pdf
3. Túnel redirige a File Server local
4. File Server envía archivo al Backend
5. Backend procesa y/o reenvía al Frontend
```

---

## ⚙️ Configuración de Variables de Entorno

### Render (Backend)
```env
FILE_SERVER_URL=https://abc123.trycloudflare.com
```

### Vercel (Frontend)
```env
NEXT_PUBLIC_FILE_SERVER_URL=https://abc123.trycloudflare.com
```

### Máquina Local (File Server)
```env
FILE_SERVER_PORT=3002
```

---

## 🔄 Proceso de Actualización de URL del Túnel

**Cada vez que reinicies el túnel:**

1. **Obtener nueva URL del túnel**
   ```powershell
   cd C:\Users\Administrador\Desktop\ACLYSA\ACLYSA\FileServer
   .\start-tunnel-permanent.bat
   # Copiar URL: https://xyz789.trycloudflare.com
   ```

2. **Actualizar Render**
   - Dashboard → Backend → Environment
   - `FILE_SERVER_URL = https://xyz789.trycloudflare.com`
   - Save (redespliega automáticamente)

3. **Actualizar Vercel**
   - Dashboard → Frontend → Settings → Environment Variables
   - `NEXT_PUBLIC_FILE_SERVER_URL = https://xyz789.trycloudflare.com`
   - Deployments → Redeploy

---

## ✅ Ventajas de esta Arquitectura

- ✅ Backend en la nube (escalable)
- ✅ No requiere servidor local para el backend
- ✅ Archivos permanecen en servidor local (seguridad)
- ✅ Fácil de implementar
- ✅ Bajo costo (túnel gratuito)

## ❌ Desventajas

- ❌ URL del túnel cambia al reiniciar
- ❌ Requiere máquina local siempre encendida
- ❌ Latencia adicional por el túnel
- ❌ Dependencia de servicio de túnel

---

## 🎯 Migración Futura Recomendada

### Azure Blob Storage

**Arquitectura ideal:**
```
Vercel → Render → Azure Blob Storage
                     ↑
                  Archivos con URLs públicas
```

**Ventajas:**
- ✅ No requiere túnel
- ✅ No requiere máquina local encendida
- ✅ URLs permanentes
- ✅ CDN integrado
- ✅ Escalable infinitamente
- ✅ Backup automático

**Pasos de migración:**
1. Crear Azure Storage Account
2. Migrar archivos existentes de E:\ a Blob
3. Actualizar rutas en SQL Server
4. Modificar backend para usar Azure SDK
5. Eliminar File Server y túnel

---

**Última actualización:** 2026-03-26  
**Versión:** 1.0
