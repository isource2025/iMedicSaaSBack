/**
 * Rutas temporales para actualización masiva
 */

const express = require('express');
const router = express.Router();
const actualizacionController = require('../controllers/actualizacion.controller');

// POST /api/actualizacion/ejecutar - Ejecutar actualización masiva
router.post('/ejecutar', actualizacionController.ejecutarActualizacionMasiva);

// GET /api/actualizacion/frecuencias - Verificar valores de frecuencias
router.get('/frecuencias', actualizacionController.verificarFrecuencias);

module.exports = router;
