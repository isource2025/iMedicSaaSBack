const express = require('express');
const router = express.Router();
const {
  obtenerIndicadores,
  obtenerResumenIndicadores,
  obtenerIndicadoresPorFecha,
  obtenerResumenPacientesHoy
} = require('../controllers/indicadores.controller');

// GET /api/indicadores - Obtener indicadores básicos
router.get('/', obtenerIndicadores);

// GET /api/indicadores/resumen - Obtener resumen agrupado por clase de paciente
router.get('/resumen', obtenerResumenIndicadores);

// GET /api/indicadores/por-fecha - Obtener indicadores agrupados por fecha
router.get('/por-fecha', obtenerIndicadoresPorFecha);

// GET /api/indicadores/pacientes/resumen-hoy - Obtener resumen de pacientes para hoy
router.get('/pacientes/resumen-hoy', obtenerResumenPacientesHoy);

module.exports = router;
