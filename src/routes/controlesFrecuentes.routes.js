const express = require('express');
const router = express.Router();
const controlesFrecuentesController = require('../controllers/controlesFrecuentes.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get(
	'/:numeroVisita/byDate',
	requirePermiso('INTERNACION.SIGNOS_VITALES.VER'),
	controlesFrecuentesController.obtenerControlesPorVisitaYFecha,
);
router.get(
	'/detalle/:valor',
	requirePermiso('INTERNACION.SIGNOS_VITALES.VER'),
	controlesFrecuentesController.obtenerControlPorId,
);
router.post('/', requirePermiso('INTERNACION.SIGNOS_VITALES.CREAR'), controlesFrecuentesController.crearControl);
router.delete(
	'/:valor',
	requirePermiso('INTERNACION.SIGNOS_VITALES.ELIMINAR'),
	controlesFrecuentesController.eliminarControl,
);

module.exports = router;
