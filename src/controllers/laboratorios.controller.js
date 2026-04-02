const laboratoriosService = require('../services/laboratorios-simple.service');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configurar multer para subida de archivos
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB máximo
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo PDF, JPG y PNG.'));
    }
  }
});

/**
 * Procesa un archivo con OCR
 * POST /api/laboratorios/upload-ocr
 */
const uploadYProcesarOCR = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se proporcionó ningún archivo'
      });
    }

    const { numeroVisita } = req.body;
    
    console.log('📄 Archivo recibido:');
    console.log('  - Nombre original:', req.file.originalname);
    console.log('  - MIME type:', req.file.mimetype);
    console.log('  - Tamaño:', req.file.size, 'bytes');
    console.log('  - Buffer length:', req.file.buffer.length);
    console.log('  - Primeros 20 bytes:', req.file.buffer.slice(0, 20).toString('hex'));
    
    if (!numeroVisita) {
      return res.status(400).json({
        success: false,
        error: 'El número de visita es requerido'
      });
    }

    // Validar que el archivo no esté vacío o corrupto
    if (req.file.size < 100) {
      return res.status(400).json({
        success: false,
        error: 'El archivo está vacío o corrupto (tamaño menor a 100 bytes)'
      });
    }

    // Procesar archivo con OCR
    const resultado = await laboratoriosService.procesarArchivoConOCR(
      req.file.buffer,
      req.file.mimetype
    );

    res.json({
      success: true,
      data: resultado,
      mensaje: 'Archivo procesado correctamente con OCR'
    });
  } catch (error) {
    console.error('Error en uploadYProcesarOCR:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al procesar el archivo'
    });
  }
};

/**
 * Guarda un examen de laboratorio
 * POST /api/laboratorios/save
 */
const guardarExamen = async (req, res) => {
  try {
    const { cabecera, detalles, pacienteInfo } = req.body;

    if (!cabecera || !detalles || detalles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos. Se requiere cabecera y al menos un detalle'
      });
    }

    const examen = await laboratoriosService.guardarExamen(
      cabecera,
      detalles,
      pacienteInfo || {}
    );

    res.json({
      success: true,
      data: examen,
      mensaje: 'Examen guardado correctamente'
    });
  } catch (error) {
    console.error('Error en guardarExamen:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al guardar el examen'
    });
  }
};

/**
 * Obtiene todos los exámenes de una visita
 * GET /api/laboratorios/visita/:numeroVisita
 */
const obtenerExamenesPorVisita = async (req, res) => {
  try {
    const { numeroVisita } = req.params;

    if (!numeroVisita) {
      return res.status(400).json({
        success: false,
        error: 'Número de visita requerido'
      });
    }

    const examenes = await laboratoriosService.obtenerExamenesPorVisita(numeroVisita);

    res.json({
      success: true,
      data: examenes,
      total: examenes.length
    });
  } catch (error) {
    console.error('Error en obtenerExamenesPorVisita:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener exámenes'
    });
  }
};

/**
 * Obtiene un examen por su ID
 * GET /api/laboratorios/:idExamen
 */
const obtenerExamenPorId = async (req, res) => {
  try {
    const { idExamen } = req.params;

    const examen = await laboratoriosService.obtenerExamenPorId(idExamen);

    if (!examen) {
      return res.status(404).json({
        success: false,
        error: 'Examen no encontrado'
      });
    }

    res.json({
      success: true,
      data: examen
    });
  } catch (error) {
    console.error('Error en obtenerExamenPorId:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener el examen'
    });
  }
};

/**
 * Actualiza un examen
 * PUT /api/laboratorios/:idExamen
 */
const actualizarExamen = async (req, res) => {
  try {
    const { idExamen } = req.params;
    const { cabecera, detalles } = req.body;

    const examen = await laboratoriosService.actualizarExamen(idExamen, cabecera, detalles);

    res.json({
      success: true,
      data: examen,
      mensaje: 'Examen actualizado correctamente'
    });
  } catch (error) {
    console.error('Error en actualizarExamen:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al actualizar el examen'
    });
  }
};

/**
 * Elimina un examen
 * DELETE /api/laboratorios/:idExamen
 */
const eliminarExamen = async (req, res) => {
  try {
    const { idExamen } = req.params;

    await laboratoriosService.eliminarExamen(idExamen);

    res.json({
      success: true,
      mensaje: 'Examen eliminado correctamente'
    });
  } catch (error) {
    console.error('Error en eliminarExamen:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al eliminar el examen'
    });
  }
};

/**
 * Obtiene todos los parámetros de configuración
 * GET /api/laboratorios/parametros/config
 */
const obtenerParametrosConfig = async (req, res) => {
  try {
    const parametros = await laboratoriosService.obtenerParametrosConfiguracion();

    res.json({
      success: true,
      data: parametros,
      total: parametros.length
    });
  } catch (error) {
    console.error('Error en obtenerParametrosConfig:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener parámetros de configuración'
    });
  }
};

/**
 * Actualiza un parámetro de configuración
 * PUT /api/laboratorios/parametros/config/:idParametro
 */
const actualizarParametroConfig = async (req, res) => {
  try {
    const { idParametro } = req.params;
    const datos = req.body;

    const parametro = await laboratoriosService.actualizarParametroConfiguracion(
      idParametro,
      datos
    );

    res.json({
      success: true,
      data: parametro,
      mensaje: 'Parámetro actualizado correctamente'
    });
  } catch (error) {
    console.error('Error en actualizarParametroConfig:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al actualizar parámetro'
    });
  }
};

module.exports = {
  upload,
  uploadYProcesarOCR,
  guardarExamen,
  obtenerExamenesPorVisita,
  obtenerExamenPorId,
  actualizarExamen,
  eliminarExamen,
  obtenerParametrosConfig,
  actualizarParametroConfig
};
