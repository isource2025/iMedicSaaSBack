/**
 * Servidor HTTP de archivos para iMedicWs
 * Este servidor debe correr en la máquina 181.4.71.230 que tiene acceso al disco E:\
 * 
 * Instalación:
 * 1. Copiar este archivo a la máquina 181.4.71.230
 * 2. npm install express cors
 * 3. node file-server-standalone.js
 * 
 * O usar PM2 para mantenerlo corriendo:
 * pm2 start file-server-standalone.js --name "imedic-file-server"
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.FILE_SERVER_PORT || 3002;

// Configurar CORS para permitir acceso desde Render y frontend
app.use(cors({
  origin: '*', // En producción, restringir a dominios específicos
  credentials: true
}));

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

/**
 * Normaliza la ruta del archivo (mapea D:\ y F:\ a E:\)
 */
function normalizarRuta(rutaOriginal) {
  if (!rutaOriginal) return null;

  let ruta = rutaOriginal;

  // Mapear D:\ a E:\
  if (ruta.startsWith('D:\\')) {
    ruta = ruta.replace(/^D:\\/, 'E:\\');
    console.log(`🔄 Mapeado D:\\ a E:\\: ${rutaOriginal} -> ${ruta}`);
  }

  // Mapear F:\ a E:\
  if (ruta.startsWith('F:\\')) {
    ruta = ruta.replace(/^F:\\/, 'E:\\');
    console.log(`🔄 Mapeado F:\\ a E:\\: ${rutaOriginal} -> ${ruta}`);
  }

  return ruta;
}

/**
 * GET /file?path=<ruta>
 * Sirve un archivo dado su path
 */
app.get('/file', (req, res) => {
  try {
    const { path: rutaOriginal } = req.query;

    if (!rutaOriginal) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro "path" es requerido'
      });
    }

    console.log(`📂 Solicitado: ${rutaOriginal}`);

    // Normalizar la ruta
    const rutaNormalizada = normalizarRuta(rutaOriginal);

    if (!rutaNormalizada) {
      return res.status(400).json({
        success: false,
        error: 'Ruta inválida'
      });
    }

    // Verificar que el archivo existe
    if (!fs.existsSync(rutaNormalizada)) {
      console.error(`❌ Archivo no encontrado: ${rutaNormalizada}`);
      return res.status(404).json({
        success: false,
        error: 'Archivo no encontrado',
        rutaOriginal,
        rutaNormalizada
      });
    }

    // Verificar que es un archivo (no un directorio)
    const stats = fs.statSync(rutaNormalizada);
    if (!stats.isFile()) {
      console.error(`❌ La ruta no es un archivo: ${rutaNormalizada}`);
      return res.status(400).json({
        success: false,
        error: 'La ruta especificada no es un archivo'
      });
    }

    // Determinar tipo MIME
    const ext = path.extname(rutaNormalizada).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const fileName = path.basename(rutaNormalizada);

    // Configurar headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Length', stats.size);

    console.log(`✅ Enviando archivo: ${rutaNormalizada} (${stats.size} bytes)`);

    // Enviar archivo como stream
    const fileStream = fs.createReadStream(rutaNormalizada);
    
    fileStream.on('error', (error) => {
      console.error(`❌ Error al leer archivo:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error al leer archivo'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    console.error('❌ Error al servir archivo:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * GET /
 * Info endpoint
 */
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'iMedicWs File Server',
    version: '1.0.0',
    endpoints: {
      '/file?path=<ruta>': 'Obtener archivo por ruta',
      '/health': 'Health check'
    }
  });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   iMedicWs - Servidor HTTP de Archivos        ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Servidor corriendo en: http://0.0.0.0:${PORT}`);
  console.log(`📁 Sirviendo archivos del disco E:\\`);
  console.log(`🔄 Mapeo automático: D:\\ → E:\\ y F:\\ → E:\\`);
  console.log('');
  console.log('Endpoints disponibles:');
  console.log(`  GET /file?path=<ruta>  - Obtener archivo`);
  console.log(`  GET /health            - Health check`);
  console.log('');
  console.log('Presiona Ctrl+C para detener el servidor');
  console.log('════════════════════════════════════════════════');
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});
