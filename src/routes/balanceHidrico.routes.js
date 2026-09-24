const express = require('express');
const router = express.Router();
const balanceHidricoController = require('../controllers/balanceHidrico.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _own = requirePropietario({
	tabla: 'imBalanceHidrico',
	pkCol: 'IdBalanceHidrico',
	autorCol: 'Profesional',
	pkParam: 'id',
	failSafe: true,
});

router.get(
	'/:numeroVisita/byDate',
	requirePermiso('INTERNACION.BALANCE_HIDRICO.VER'),
	balanceHidricoController.obtenerPorVisitaYFecha,
);
router.get(
	'/:numeroVisita/all',
	requirePermiso('INTERNACION.BALANCE_HIDRICO.VER'),
	balanceHidricoController.obtenerPorVisita,
);
router.get(
	'/detalle/:id',
	requirePermiso('INTERNACION.BALANCE_HIDRICO.VER'),
	balanceHidricoController.obtenerPorId,
);
router.post(
	'/',
	requirePermiso('INTERNACION.BALANCE_HIDRICO.CREAR'),
	balanceHidricoController.crear,
);
router.put(
	'/:id',
	requirePermiso('INTERNACION.BALANCE_HIDRICO.EDITAR'),
	_own,
	balanceHidricoController.actualizar,
);
router.delete(
	'/:id',
	requirePermiso('INTERNACION.BALANCE_HIDRICO.ELIMINAR'),
	_own,
	balanceHidricoController.eliminar,
);

module.exports = router;
