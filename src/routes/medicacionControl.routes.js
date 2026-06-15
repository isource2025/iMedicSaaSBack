const express = require('express');
const router = express.Router();
const medicacionControlController = require('../controllers/medicacionControl.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

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
router.delete(
	'/:idCtrlMedica',
	requirePermiso('INTERNACION.MEDICACION.ELIMINAR'),
	medicacionControlController.eliminarMedicacion,
);

module.exports = router;
