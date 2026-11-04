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
const { requirePermiso, requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

// Panel de datos (DASHBOARD.INICIO.VER) puede leer todos los KPIs que el panel ofrece,
// sin exigir permisos operativos de Turnos / Internación / Admisión.
const verPacientesInd = requireAnyPermiso('ADMISION.PACIENTES.VER', 'DASHBOARD.INICIO.VER');
const verCamasInd = requireAnyPermiso('INTERNACION.CAMAS.VER', 'DASHBOARD.INICIO.VER');
const verAmbulatorioInd = requireAnyPermiso('TURNOS.TABLA.VER', 'DASHBOARD.INICIO.VER');

router.get('/', verPacientesInd, obtenerIndicadores);
router.get('/resumen', verPacientesInd, obtenerResumenIndicadores);
router.get('/por-fecha', verPacientesInd, obtenerIndicadoresPorFecha);
router.get('/pacientes/resumen-hoy', requirePermiso('DASHBOARD.INICIO.VER'), obtenerResumenPacientesHoy);
router.get('/camas', verCamasInd, obtenerOcupacionCamas);
router.get('/camas/resumen', verCamasInd, obtenerResumenOcupacionCamas);
router.get('/camas/por-fecha', verCamasInd, obtenerOcupacionCamasPorFecha);
router.get('/camas/estado-actual', verCamasInd, obtenerEstadoActualCamas);

// Analítica ambulatoria (agenda + visitas ClasePaciente='A').
// Detalle y resumen del día: panel de datos o permiso de turnos.
router.get('/ambulatorio', verAmbulatorioInd, obtenerAnaliticaAmbulatoria);
router.get('/ambulatorio/resumen-hoy', requirePermiso('DASHBOARD.INICIO.VER'), obtenerResumenAmbulatorioHoy);

// Producción del hospital (facturado / liquidado por cobertura, sector, profesional...).
router.use('/produccion', require('./produccionHospital.routes'));

module.exports = router;
