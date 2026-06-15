const express = require('express');
const router = express.Router();
const bedsController = require('../controllers/beds.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get('/', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerCamas);
router.get('/estados', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerEstadosCama);
router.get('/sectores', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerSectores);
router.get('/total', requirePermiso('INTERNACION.OCUPACION.VER'), bedsController.obtenerTotalCamas);
router.get('/filtrar/:estado', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.filtrarCamasPorEstado);
router.get(
	'/controles-frecuentes/:numeroVisita',
	requirePermiso('INTERNACION.SIGNOS_VITALES.VER'),
	bedsController.obtenerControlesFrecuentesPorVisita,
);
router.get('/:id', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerCamaPorId);
router.put('/:id/status', requirePermiso('INTERNACION.CAMAS.GESTIONAR'), bedsController.actualizarEstadoCama);

module.exports = router;
