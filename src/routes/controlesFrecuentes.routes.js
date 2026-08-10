const express = require('express');
const router = express.Router();
const controlesFrecuentesController = require('../controllers/controlesFrecuentes.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _ownControl = requirePropietario({
	tabla: 'imInterCtrlFrecuente',
	pkCol: 'Valor',
	autorCol: 'OperadorCarga',
	pkParam: 'valor',
	failSafe: true,
});

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
router.put(
	'/:valor',
	requirePermiso('INTERNACION.SIGNOS_VITALES.EDITAR'),
	_ownControl,
	controlesFrecuentesController.actualizarControl,
);
router.delete(
	'/:valor',
	requirePermiso('INTERNACION.SIGNOS_VITALES.ELIMINAR'),
	_ownControl,
	controlesFrecuentesController.eliminarControl,
);

module.exports = router;
