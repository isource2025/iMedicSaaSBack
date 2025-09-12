const express = require('express');
const router = express.Router();
const {
  obtenerIndicadores,
  obtenerResumenIndicadores,
  obtenerIndicadoresPorFecha,
  obtenerResumenPacientesHoy,
  obtenerOcupacionCamas,
  obtenerResumenOcupacionCamas,
  obtenerOcupacionCamasPorFecha,
  obtenerEstadoActualCamas
} = require('../controllers/indicadores.controller');

// GET /api/indicadores - Obtener indicadores básicos
router.get('/', obtenerIndicadores);

// GET /api/indicadores/resumen - Obtener resumen agrupado por clase de paciente
router.get('/resumen', obtenerResumenIndicadores);

// GET /api/indicadores/por-fecha - Obtener indicadores agrupados por fecha
router.get('/por-fecha', obtenerIndicadoresPorFecha);

// GET /api/indicadores/pacientes/resumen-hoy - Obtener resumen de pacientes para hoy
router.get('/pacientes/resumen-hoy', obtenerResumenPacientesHoy);

// ============================
//  Analítica de Camas
// ============================
// GET /api/indicadores/camas - Lista cruda de ocupación promedio de camas
router.get('/camas', obtenerOcupacionCamas);

// GET /api/indicadores/camas/resumen - Resumen (promedios en el período)
router.get('/camas/resumen', obtenerResumenOcupacionCamas);

// GET /api/indicadores/camas/por-fecha - Series temporales para gráficos
router.get('/camas/por-fecha', obtenerOcupacionCamasPorFecha);

// GET /api/indicadores/camas/estado-actual - Estado actual de ocupación (hoy)
router.get('/camas/estado-actual', obtenerEstadoActualCamas);

module.exports = router;
