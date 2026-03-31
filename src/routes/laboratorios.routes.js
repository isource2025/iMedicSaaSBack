const express = require('express');
const router = express.Router();
const laboratoriosController = require('../controllers/laboratorios.controller');

/**
 * Rutas para gestión de laboratorios
 */

// Procesar archivo con OCR
router.post(
  '/upload-ocr',
  laboratoriosController.upload.single('archivo'),
  laboratoriosController.uploadYProcesarOCR
);

// Guardar examen completo
router.post('/save', laboratoriosController.guardarExamen);

// Obtener exámenes por visita
router.get('/visita/:numeroVisita', laboratoriosController.obtenerExamenesPorVisita);

// Obtener examen por ID
router.get('/:idExamen', laboratoriosController.obtenerExamenPorId);

// Actualizar examen
router.put('/:idExamen', laboratoriosController.actualizarExamen);

// Eliminar examen
router.delete('/:idExamen', laboratoriosController.eliminarExamen);

// Obtener parámetros de configuración
router.get('/parametros/config', laboratoriosController.obtenerParametrosConfig);

// Actualizar parámetro de configuración
router.put('/parametros/config/:idParametro', laboratoriosController.actualizarParametroConfig);

module.exports = router;
