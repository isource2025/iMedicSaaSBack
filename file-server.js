const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.FILE_SERVER_PORT || 3902;
const DEFAULT_UPLOAD_ROOT = process.env.FILE_SERVER_ROOT || 'E:\\adjuntos';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({ dest: path.join(process.cwd(), '.tmp-uploads') });

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

function ensureFolderForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
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
      '.dcm': 'application/dicom',
      '.dicom': 'application/dicom',
      '.webm': 'video/webm',
      '.mp4': 'video/mp4',
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
 * POST /upload
 * multipart/form-data:
 *  - file: archivo
 *  - path: ruta destino absoluta o relativa a E:\adjuntos
 */
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Archivo requerido (field: file)' });
    }

    const requestedPath = (req.body?.path || '').trim();
    const destinationPath = requestedPath
      ? normalizarRuta(requestedPath)
      : path.join(DEFAULT_UPLOAD_ROOT, req.file.originalname);

    ensureFolderForFile(destinationPath);
    fs.renameSync(req.file.path, destinationPath);

    console.log(`✅ Archivo subido: ${destinationPath}`);
    return res.status(201).json({
      success: true,
      path: destinationPath,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('❌ Error al subir archivo:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al subir archivo',
      details: error.message
    });
  }
});

/**
 * DELETE /file?path=E:\ruta\archivo.ext
 */
app.delete('/file', (req, res) => {
  try {
    const filePath = normalizarRuta(req.query.path);
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Parámetro path es requerido' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ Archivo eliminado: ${filePath}`);
    return res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('❌ Error al eliminar archivo:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al eliminar archivo',
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
  console.log(`📁 Base por defecto para subidas: ${DEFAULT_UPLOAD_ROOT}`);
  console.log(`📌 Endpoints: GET /health, GET /file, POST /upload, DELETE /file`);
});
