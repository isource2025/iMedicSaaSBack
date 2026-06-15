const express = require('express');
const router = express.Router();
const visitaMovimientosController = require('../controllers/visitaMovimientos.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get(
	'/ultimo/:numeroVisita',
	requirePermiso('INTERNACION.MOVIMIENTOS.VER'),
	visitaMovimientosController.obtenerUltimoMovimientoVisita,
);
router.get(
	'/visita/:numeroVisita',
	requirePermiso('INTERNACION.MOVIMIENTOS.VER'),
	visitaMovimientosController.obtenerMovimientosVisita,
);
router.put(
	'/ultimo/:numeroVisita',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	visitaMovimientosController.actualizarUltimoMovimientoVisita,
);
router.post(
	'/mover/:numeroVisita',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	visitaMovimientosController.moverPacienteACamaVacia,
);
router.post(
	'/intercambiar/:numeroVisita1/:numeroVisita2',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	visitaMovimientosController.intercambiarCamasPacientes,
);
router.get(
	'/recientes',
	requirePermiso('INTERNACION.MOVIMIENTOS.VER'),
	visitaMovimientosController.obtenerMovimientosRecientes,
);

module.exports = router;
