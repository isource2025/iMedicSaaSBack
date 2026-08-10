const express = require('express');
const router = express.Router();
const medicacionControlController = require('../controllers/medicacionControl.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _ownMedicacion = requirePropietario({
	tabla: 'imInterCtrlMedicamento',
	pkCol: 'IDCtrlMedica',
	autorCol: 'OperadorCarga',
	pkParam: 'idCtrlMedica',
	failSafe: true,
});

router.get(
	'/:numeroVisita',
	requirePermiso('INTERNACION.MEDICACION.VER'),
	medicacionControlController.obtenerMedicacionPorVisita,
);
router.get(
	'/:numeroVisita/byDate',
	requirePermiso('INTERNACION.MEDICACION.VER'),
	medicacionControlController.obtenerMedicacionPorVisitaYFecha,
);
router.get(
	'/detalle/:idCtrlMedica',
	requirePermiso('INTERNACION.MEDICACION.VER'),
	medicacionControlController.obtenerMedicacionPorId,
);
router.put(
	'/:idCtrlMedica',
	requirePermiso('INTERNACION.MEDICACION.EDITAR'),
	_ownMedicacion,
	medicacionControlController.actualizarMedicacion,
);
router.delete(
	'/:idCtrlMedica',
	requirePermiso('INTERNACION.MEDICACION.ELIMINAR'),
	_ownMedicacion,
	medicacionControlController.eliminarMedicacion,
);

module.exports = router;
