const express = require('express');
const router = express.Router();
const evolucionEnfermeriaController = require('../controllers/evolucionEnfermeria.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get(
	'/:numeroVisita/byDate',
	requirePermiso('INTERNACION.EVOLUCION_ENFERMERIA.VER'),
	evolucionEnfermeriaController.obtenerEvolucionesPorVisitaYFecha,
);
router.post('/', requirePermiso('INTERNACION.EVOLUCION_ENFERMERIA.CREAR'), evolucionEnfermeriaController.crearEvolucion);
router.delete(
	'/',
	requirePermiso('INTERNACION.EVOLUCION_ENFERMERIA.ELIMINAR'),
	evolucionEnfermeriaController.eliminarEvolucion,
);

module.exports = router;
