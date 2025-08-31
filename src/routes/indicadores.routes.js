const express = require('express');
const router = express.Router();
const indicadoresController = require('../controllers/indicadores.controller');

// GET /api/indicadores - Obtener indicadores básicos
router.get('/', indicadoresController.obtenerIndicadores);

// GET /api/indicadores/resumen - Obtener resumen agrupado por clase de paciente
router.get('/resumen', indicadoresController.obtenerResumenIndicadores);

// GET /api/indicadores/por-fecha - Obtener indicadores agrupados por fecha
router.get('/por-fecha', indicadoresController.obtenerIndicadoresPorFecha);

module.exports = router;
