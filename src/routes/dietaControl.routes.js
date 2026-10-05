const express = require('express');
const router = express.Router();
const dietaControlController = require('../controllers/dietaControl.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _own = requirePropietario({
	tabla: 'imInterCtrlDieta',
	pkCol: 'Valor',
	autorCol: 'OperadorCarga',
	pkParam: 'id',
	failSafe: true,
});

router.get(
	'/tipos',
	requirePermiso('INTERNACION.DIETA.VER'),
	dietaControlController.obtenerTipos,
);
router.get(
	'/detalle/:id',
	requirePermiso('INTERNACION.DIETA.VER'),
	dietaControlController.obtenerPorId,
);
router.get(
	'/:numeroVisita/byDate',
	requirePermiso('INTERNACION.DIETA.VER'),
	dietaControlController.obtenerPorVisitaYFecha,
);
router.post('/', requirePermiso('INTERNACION.DIETA.CREAR'), dietaControlController.crear);
router.put(
	'/:id',
	requirePermiso('INTERNACION.DIETA.EDITAR'),
	_own,
	dietaControlController.actualizar,
);
router.delete(
	'/:id',
	requirePermiso('INTERNACION.DIETA.ELIMINAR'),
	_own,
	dietaControlController.eliminar,
);

module.exports = router;
