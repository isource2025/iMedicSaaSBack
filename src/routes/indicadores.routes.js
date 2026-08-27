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
const {
	obtenerAnaliticaAmbulatoria,
	obtenerResumenAmbulatorioHoy,
} = require('../controllers/ambulatorio.controller');
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

// Analítica ambulatoria (agenda + visitas ClasePaciente='A').
// El resumen del día alimenta la card del panel, por eso comparte el permiso del dashboard.
router.get('/ambulatorio', requirePermiso('TURNOS.TABLA.VER'), obtenerAnaliticaAmbulatoria);
router.get('/ambulatorio/resumen-hoy', requirePermiso('DASHBOARD.INICIO.VER'), obtenerResumenAmbulatorioHoy);

module.exports = router;
