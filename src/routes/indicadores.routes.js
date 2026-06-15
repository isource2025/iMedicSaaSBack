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

router.get('/', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerIndicadores);
router.get('/resumen', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerResumenIndicadores);
router.get('/por-fecha', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerIndicadoresPorFecha);
router.get('/pacientes/resumen-hoy', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerResumenPacientesHoy);
router.get('/camas', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerOcupacionCamas);
router.get('/camas/resumen', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerResumenOcupacionCamas);
router.get('/camas/por-fecha', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerOcupacionCamasPorFecha);
router.get('/camas/estado-actual', requirePermiso('INTERNACION.OCUPACION.VER'), obtenerEstadoActualCamas);

module.exports = router;
