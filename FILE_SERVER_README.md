# Servidor HTTP de Archivos - iMedicWs

Este servidor debe correr en la máquina **181.4.71.230** que tiene acceso al disco E:\ con todos los archivos.

## Instalación en 181.4.71.230

### 1. Copiar el archivo
Copiar `file-server-standalone.js` a la máquina 181.4.71.230

### 2. Instalar dependencias
```bash
npm install express cors
```

### 3. Ejecutar el servidor

**Opción A: Ejecución simple (para pruebas)**
```bash
node file-server-standalone.js
```

**Opción B: Con PM2 (recomendado para producción)**
```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar el servidor
pm2 start file-server-standalone.js --name "imedic-file-server"

# Ver logs
pm2 logs imedic-file-server

# Reiniciar
pm2 restart imedic-file-server

# Detener
pm2 stop imedic-file-server

# Configurar para que inicie automáticamente al reiniciar Windows
pm2 startup
pm2 save
```

### 4. Verificar que funciona
Abrir en el navegador: `http://181.4.71.230:3002/health`

Debería responder:
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "...",
  "uptime": ...
}
```

### 5. Probar con un archivo
```
http://181.4.71.230:3002/file?path=E:\Escritorio\16-3-26\60681 LEYES CYNTIA.pdf
```

## Configuración del Backend en Render

Agregar la variable de entorno en Render:

```
FILE_SERVER_URL=http://181.4.71.230:3002
```

## Firewall

Asegurarse de que el puerto **3002** esté abierto en el firewall de Windows:

```powershell
# Abrir PowerShell como Administrador
New-NetFirewallRule -DisplayName "iMedic File Server" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow
```

## Funcionamiento

1. El frontend sube archivos → Backend en Render → Guarda ruta en BD
2. El frontend solicita ver archivo → Backend en Render → Solicita al servidor HTTP (181.4.71.230) → Servidor lee del disco E:\ → Devuelve archivo
3. Mapeo automático: D:\ → E:\ y F:\ → E:\

## Logs

El servidor muestra logs de todas las solicitudes:
- 📂 Archivo solicitado
- 🔄 Mapeos de rutas (D:\ → E:\)
- ✅ Archivo enviado exitosamente
- ❌ Errores (archivo no encontrado, etc.)
