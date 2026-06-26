const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const adjuntosService = require('../services/adjuntos.service');
const { notificarNuevoAdjunto } = require('../services/notificacionesAdjuntos.service');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || 'http://181.4.71.230:3002';
const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);

/** Si el servidor HTTP de archivos no responde (timeout/red), guardar ruta absoluta del archivo en disco del backend. */
const FILE_SERVER_FALLBACK_LOCAL =
  process.env.FILE_SERVER_FALLBACK_LOCAL === '1' ||
  process.env.ADJUNTOS_LOCAL_FALLBACK === '1' ||
  process.env.NODE_ENV !== 'production';

function resolveUserId(req) {
  return req.valorPersonal || req.auth?.usuario?.id || null;
}

function isFileServerNetworkError(err) {
  const code = err && (err.code || (err.cause && err.cause.code));
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNABORTED'
  );
}

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

function contentTypeForAdjuntoFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.dcm': 'application/dicom',
    '.dicom': 'application/dicom',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Configurar multer para upload de archivos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const uploadPath = path.join(__dirname, '../../uploads', year.toString(), month);
    
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50);
    cb(null, `${baseName}_${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'application/dicom',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    const isDicom = file.mimetype === 'application/dicom' || /\.dcm$/i.test(file.originalname || '');
    if (allowedTypes.includes(file.mimetype) || isDicom) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo PDF, imágenes (JPG, PNG, GIF), DICOM (.dcm) y documentos Word.'));
    }
  }
});

router.use(requireTenant);

/**
 * POST /api/adjuntos/upload
 * Subir archivo adjunto para una visita
 */
router.post('/upload', requirePermiso('INTERNACION.ADJUNTOS.CREAR'), upload.single('archivo'), async (req, res) => {
  try {
    const { numeroVisita, tipoImagen } = req.body;
    const userId = resolveUserId(req);

    // Validaciones
    if (!numeroVisita) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        error: 'numeroVisita es obligatorio'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionó ningún archivo'
      });
    }

    if (!tipoImagen || !String(tipoImagen).trim()) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        success: false,
        error: 'tipoImagen es obligatorio (código de HCTiposImagenes, ej. RAD, LABC)'
      });
    }

    console.log(`📤 Enviando archivo al servidor SQL: ${req.file.originalname}`);

    // Obtener nombre del paciente desde la base de datos
    const { executeQuery } = require('../models/db');
    const pacienteResult = await executeQuery(`
      SELECT TOP 1 
        p.ApellidoYNombre
      FROM imVisita v
      INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
      WHERE v.NumeroVisita = @param0
    `, [{ value: parseInt(numeroVisita) }]);

    const nombrePaciente = pacienteResult.length > 0 
      ? pacienteResult[0].ApellidoYNombre 
      : `PACIENTE_${numeroVisita}`;

    console.log(`👤 Paciente: ${nombrePaciente}`);

    let filePath;
    try {
      const formData = new FormData();
      const fileStream = fsSync.createReadStream(req.file.path);
      formData.append('file', fileStream, req.file.originalname);
      formData.append('numeroVisita', numeroVisita);
      formData.append('nombrePaciente', nombrePaciente);

      const uploadResponse = await axios.post(`${FILE_SERVER_URL}/upload`, formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: FILE_SERVER_TIMEOUT_MS
      });

      if (!uploadResponse.data.success) {
        await fs.unlink(req.file.path).catch(() => {});
        throw new Error(uploadResponse.data.error || 'Error al subir archivo al servidor');
      }

      filePath = uploadResponse.data.filePath;
      await fs.unlink(req.file.path).catch(() => {});
      console.log(`✅ Archivo guardado en servidor de archivos: ${filePath}`);
    } catch (remoteErr) {
      if (FILE_SERVER_FALLBACK_LOCAL && isFileServerNetworkError(remoteErr)) {
        filePath = path.resolve(req.file.path);
        console.warn(
          `📁 Adjunto: servidor de archivos no alcanzable; FILE_SERVER_FALLBACK_LOCAL=1 → ruta local: ${filePath}`
        );
      } else {
        await fs.unlink(req.file.path).catch(() => {});
        const msg = isFileServerNetworkError(remoteErr)
          ? 'No se pudo contactar el servidor de archivos (timeout o red). Revise VPN/red y FILE_SERVER_URL. Si no usa servidor remoto, defina FILE_SERVER_FALLBACK_LOCAL=1 en .env para guardar en disco del backend.'
          : remoteErr.message || 'Error al subir archivo';
        return res.status(503).json({
          success: false,
          error: msg
        });
      }
    }

    // Guardar referencia en base de datos con PatchServidor
    const result = await adjuntosService.subirAdjunto(
      {
        numeroVisita: parseInt(numeroVisita),
        idTipoImagen: String(tipoImagen).trim(),
      },
      req.file,
      userId,
      filePath // Ruta en el servidor SQL
    );

    console.log(`✅ Adjunto registrado en BD por usuario ${userId} para visita ${numeroVisita}`);

    await notificarNuevoAdjunto({
      numeroVisita: parseInt(numeroVisita, 10),
      idAdjunto: result.idAdjunto,
      nombreArchivo: req.file.originalname,
      valorPersonalUploader: userId,
    });

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ Error al subir adjunto:', error);

    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Error al subir archivo adjunto'
    });
  }
});

/**
 * POST /api/adjuntos/upload-multiple
 * Subir múltiples archivos adjuntos para una visita
 */
router.post('/upload-multiple', requirePermiso('INTERNACION.ADJUNTOS.CREAR'), upload.array('archivos', 5), async (req, res) => {
  try {
    const { numeroVisita, tipoImagen } = req.body;
    const userId = resolveUserId(req);

    // Validaciones
    if (!numeroVisita) {
      if (req.files) {
        for (const file of req.files) {
          await fs.unlink(file.path).catch(() => {});
        }
      }
      return res.status(400).json({
        success: false,
        error: 'numeroVisita es obligatorio'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionaron archivos'
      });
    }

    if (!tipoImagen || !String(tipoImagen).trim()) {
      for (const file of req.files) {
        await fs.unlink(file.path).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        error: 'tipoImagen es obligatorio (código de HCTiposImagenes, ej. RAD, LABC)'
      });
    }

    console.log(`📤 Enviando ${req.files.length} archivos al servidor SQL`);

    // Subir todos los adjuntos al servidor PowerShell
    const resultados = [];
    for (const file of req.files) {
      let filePath;
      try {
        const formData = new FormData();
        const fileStream = fsSync.createReadStream(file.path);
        formData.append('file', fileStream, file.originalname);

        const uploadResponse = await axios.post(`${FILE_SERVER_URL}/upload`, formData, {
          headers: {
            ...formData.getHeaders()
          },
          timeout: FILE_SERVER_TIMEOUT_MS
        });

        if (!uploadResponse.data.success) {
          await fs.unlink(file.path).catch(() => {});
          console.error(`❌ Error al subir ${file.originalname} al servidor`);
          continue;
        }

        filePath = uploadResponse.data.filePath;
        await fs.unlink(file.path).catch(() => {});
        console.log(`✅ ${file.originalname} guardado en: ${filePath}`);
      } catch (error) {
        if (FILE_SERVER_FALLBACK_LOCAL && isFileServerNetworkError(error)) {
          filePath = path.resolve(file.path);
          console.warn(`📁 Fallback local ${file.originalname}: ${filePath}`);
        } else {
          console.error(`❌ Error al subir archivo ${file.originalname}:`, error);
          await fs.unlink(file.path).catch(() => {});
          continue;
        }
      }

      try {
        const result = await adjuntosService.subirAdjunto(
          {
            numeroVisita: parseInt(numeroVisita),
            idTipoImagen: String(tipoImagen).trim(),
          },
          file,
          userId,
          filePath
        );
        resultados.push(result);
        await notificarNuevoAdjunto({
          numeroVisita: parseInt(numeroVisita, 10),
          idAdjunto: result.idAdjunto,
          nombreArchivo: file.originalname,
          valorPersonalUploader: userId,
        });
      } catch (dbErr) {
        console.error(`❌ Error BD adjunto ${file.originalname}:`, dbErr);
        await fs.unlink(file.path).catch(() => {});
      }
    }

    console.log(`✅ ${resultados.length} adjuntos registrados en BD para visita ${numeroVisita}`);

    res.status(201).json({
      success: true,
      data: resultados,
      total: resultados.length
    });
  } catch (error) {
    console.error('❌ Error al subir adjuntos múltiples:', error);
    
    // Limpiar archivos si hubo error
    if (req.files) {
      for (const file of req.files) {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    res.status(500).json({
      success: false,
      error: 'Error al subir archivos adjuntos'
    });
  }
});

/**
 * GET /api/adjuntos/tipos-imagenes
 * Catálogo para tipo de adjunto (HCTiposImagenes).
 */
router.get('/tipos-imagenes', requirePermiso('INTERNACION.ADJUNTOS.VER'), async (req, res) => {
  try {
    const tipos = await adjuntosService.listarTiposImagen();
    res.json({ success: true, data: tipos });
  } catch (error) {
    console.error('❌ Error al listar tipos de imagen:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al listar tipos de imagen',
    });
  }
});

/**
 * GET /api/adjuntos/visita/:numeroVisita
 * Obtener adjuntos de una visita
 */
router.get('/visita/:numeroVisita', requirePermiso('INTERNACION.ADJUNTOS.VER'), async (req, res) => {
  try {
    const { numeroVisita } = req.params;
    
    const adjuntos = await adjuntosService.getAdjuntosPorVisita(parseInt(numeroVisita));
    
    res.json({
      success: true,
      data: adjuntos,
      total: adjuntos.length
    });
  } catch (error) {
    console.error('❌ Error al obtener adjuntos por visita:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener adjuntos'
    });
  }
});

/**
 * GET /api/adjuntos/visita/:numeroVisita/agrupados
 * Obtener adjuntos de una visita agrupados por tipo de imagen
 */
router.get('/visita/:numeroVisita/agrupados', requirePermiso('INTERNACION.ADJUNTOS.VER'), async (req, res) => {
  try {
    const { numeroVisita } = req.params;
    
    const grupos = await adjuntosService.getAdjuntosAgrupadosPorTipo(parseInt(numeroVisita));
    
    res.json({
      success: true,
      data: grupos,
      totalGrupos: grupos.length,
      totalAdjuntos: grupos.reduce((sum, g) => sum + g.cantidad, 0)
    });
  } catch (error) {
    console.error('❌ Error al obtener adjuntos agrupados:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener adjuntos agrupados'
    });
  }
});

/**
 * GET /api/adjuntos/:idAdjunto
 * Obtener información de un adjunto
 */
router.get('/:idAdjunto', requirePermiso('INTERNACION.ADJUNTOS.VER'), async (req, res) => {
  try {
    const { idAdjunto } = req.params;
    
    const adjunto = await adjuntosService.getAdjuntoPorId(parseInt(idAdjunto));
    
    if (!adjunto) {
      return res.status(404).json({
        success: false,
        error: 'Adjunto no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: adjunto
    });
  } catch (error) {
    console.error('❌ Error al obtener adjunto:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener adjunto'
    });
  }
});

/**
 * GET /api/adjuntos/:idAdjunto/download
 * Descargar archivo adjunto desde el servidor HTTP de archivos
 */
router.get('/:idAdjunto/download', requirePermiso('INTERNACION.ADJUNTOS.VER'), async (req, res) => {
  try {
    const { idAdjunto } = req.params;
    
    const adjunto = await adjuntosService.getAdjuntoPorId(parseInt(idAdjunto));
    
    if (!adjunto) {
      return res.status(404).json({
        success: false,
        error: 'Adjunto no encontrado'
      });
    }
    
    console.log(`📂 Solicitando archivo al servidor: ${adjunto.RutaArchivo}`);
    
    // Normalizar la ruta (mapear D:\ y F:\ a E:\)
    const rutaNormalizada = normalizarRuta(adjunto.RutaArchivo);
    
    if (rutaNormalizada !== adjunto.RutaArchivo) {
      console.log(`🔄 Ruta normalizada: ${adjunto.RutaArchivo} -> ${rutaNormalizada}`);
    }
    
    // Solicitar el archivo al servidor HTTP de archivos
    try {
      // Construir URL manualmente para controlar la codificación
      const encodedPath = encodeURIComponent(rutaNormalizada);
      const fileUrl = `${FILE_SERVER_URL}/file?path=${encodedPath}`;
      
      console.log(`🌐 URL solicitada: ${fileUrl}`);
      
      const response = await axios.get(fileUrl, {
        responseType: 'stream',
        timeout: FILE_SERVER_TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength === 0) {
        return res.status(502).json({
          success: false,
          error: 'El servidor de archivos devolvió un archivo vacío',
          rutaNormalizada,
        });
      }
      
      const fileName = adjunto.NombreArchivo || path.basename(rutaNormalizada);
      const contentType = contentTypeForAdjuntoFileName(fileName);
      
      // Configurar headers para visualización inline
      res.setHeader('Content-Type', contentType);
      // Usar filename* para soportar caracteres UTF-8
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      
      console.log(`✅ Enviando archivo: ${fileName} (${contentType})`);
      
      // Pipe del stream del servidor de archivos al cliente
      response.data.pipe(res);
      
    } catch (fileError) {
      console.error(`❌ Error al obtener archivo del servidor HTTP:`, fileError.message);

      const candidates = [rutaNormalizada, adjunto.RutaArchivo].filter(
        (p) => typeof p === 'string' && p.length > 0
      );
      let localPath;
      for (const p of candidates) {
        if (fsSync.existsSync(p)) {
          localPath = p;
          break;
        }
      }

      if (localPath) {
        const fileName = adjunto.NombreArchivo || path.basename(localPath);
        const contentType = contentTypeForAdjuntoFileName(fileName);
        res.setHeader('Content-Type', contentType);
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
        );
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        console.log(`✅ Sirviendo adjunto desde disco local: ${localPath}`);
        fsSync.createReadStream(localPath).pipe(res);
        return;
      }

      if (fileError.response?.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'Archivo no encontrado en el servidor',
          rutaOriginal: adjunto.RutaArchivo,
          rutaNormalizada
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Error al obtener archivo del servidor de archivos',
        details: fileError.message
      });
    }
  } catch (error) {
    console.error('❌ Error al descargar adjunto:', error);
    res.status(500).json({
      success: false,
      error: 'Error al descargar adjunto'
    });
  }
});

/**
 * DELETE /api/adjuntos/:idAdjunto
 * Eliminar adjunto
 */
router.delete('/:idAdjunto', requirePermiso('INTERNACION.ADJUNTOS.ELIMINAR'), async (req, res) => {
  try {
    const { idAdjunto } = req.params;
    const userId = resolveUserId(req);
    
    await adjuntosService.eliminarAdjunto(parseInt(idAdjunto), userId);
    
    res.json({
      success: true,
      message: 'Adjunto eliminado correctamente'
    });
  } catch (error) {
    console.error('❌ Error al eliminar adjunto:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al eliminar adjunto'
    });
  }
});

module.exports = router;
