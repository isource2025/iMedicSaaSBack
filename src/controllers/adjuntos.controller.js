const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const adjuntosService = require('../services/adjuntos.service');

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
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo PDF, imágenes (JPG, PNG, GIF) y documentos Word.'));
    }
  }
});

/**
 * POST /api/adjuntos/upload
 * Subir archivo adjunto para una visita
 */
router.post('/upload', upload.single('archivo'), async (req, res) => {
  try {
    const { numeroVisita } = req.body;
    const userId = req.user?.id || req.body.userId || 1; // Obtener del token o default

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

    // Subir adjunto
    const result = await adjuntosService.subirAdjunto(
      {
        numeroVisita: parseInt(numeroVisita)
      },
      req.file,
      userId
    );

    console.log(`✅ Adjunto subido por usuario ${userId} para visita ${numeroVisita}: ${req.file.originalname}`);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ Error al subir adjunto:', error);
    
    // Limpiar archivo si hubo error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({
      success: false,
      error: 'Error al subir archivo adjunto'
    });
  }
});

/**
 * POST /api/adjuntos/upload-multiple
 * Subir múltiples archivos adjuntos para una visita
 */
router.post('/upload-multiple', upload.array('archivos', 5), async (req, res) => {
  try {
    const { numeroVisita } = req.body;
    const userId = req.user?.id || req.body.userId || 1;

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

    // Subir todos los adjuntos
    const resultados = [];
    for (const file of req.files) {
      try {
        const result = await adjuntosService.subirAdjunto(
          {
            numeroVisita: parseInt(numeroVisita)
          },
          file,
          userId
        );
        resultados.push(result);
      } catch (error) {
        console.error(`❌ Error al subir archivo ${file.originalname}:`, error);
        // Continuar con los demás archivos
      }
    }

    console.log(`✅ ${resultados.length} adjuntos subidos por usuario ${userId} para visita ${numeroVisita}`);

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
 * GET /api/adjuntos/visita/:numeroVisita
 * Obtener adjuntos de una visita
 */
router.get('/visita/:numeroVisita', async (req, res) => {
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
 * GET /api/adjuntos/:idAdjunto
 * Obtener información de un adjunto
 */
router.get('/:idAdjunto', async (req, res) => {
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
 * Descargar archivo adjunto
 */
router.get('/:idAdjunto/download', async (req, res) => {
  try {
    const { idAdjunto } = req.params;
    
    const adjunto = await adjuntosService.getAdjuntoPorId(parseInt(idAdjunto));
    
    if (!adjunto) {
      return res.status(404).json({
        success: false,
        error: 'Adjunto no encontrado'
      });
    }
    
    // Verificar que el archivo existe
    try {
      await fs.access(adjunto.RutaArchivo);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Archivo no encontrado en el servidor'
      });
    }
    
    // Enviar archivo
    res.download(adjunto.RutaArchivo, adjunto.NombreArchivo, (err) => {
      if (err) {
        console.error('❌ Error al descargar archivo:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error al descargar archivo'
          });
        }
      }
    });
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
router.delete('/:idAdjunto', async (req, res) => {
  try {
    const { idAdjunto } = req.params;
    const userId = req.user?.id || req.body.userId || 1;
    
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
