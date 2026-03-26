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
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor de archivos corriendo en puerto ${PORT}`);
  console.log(`📁 Listo para servir archivos desde rutas locales`);
});
