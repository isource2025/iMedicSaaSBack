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
	obtenerEstadoActualCamas,
} = require('../controllers/indicadores.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get('/', requirePermiso('ADMISION.PACIENTES.VER'), obtenerIndicadores);
router.get('/resumen', requirePermiso('ADMISION.PACIENTES.VER'), obtenerResumenIndicadores);
router.get('/por-fecha', requirePermiso('ADMISION.PACIENTES.VER'), obtenerIndicadoresPorFecha);
router.get('/pacientes/resumen-hoy', requirePermiso('DASHBOARD.INICIO.VER'), obtenerResumenPacientesHoy);
router.get('/camas', requirePermiso('INTERNACION.CAMAS.VER'), obtenerOcupacionCamas);
router.get('/camas/resumen', requirePermiso('INTERNACION.CAMAS.VER'), obtenerResumenOcupacionCamas);
router.get('/camas/por-fecha', requirePermiso('INTERNACION.CAMAS.VER'), obtenerOcupacionCamasPorFecha);
router.get('/camas/estado-actual', requirePermiso('INTERNACION.CAMAS.VER'), obtenerEstadoActualCamas);

module.exports = router;
