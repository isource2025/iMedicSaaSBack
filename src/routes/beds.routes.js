const express = require('express');
const router = express.Router();
const bedsController = require('../controllers/beds.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get('/', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerCamas);
// Lista + sectores + estados en una request (debe ir antes de '/:id').
router.get('/bootstrap', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerBootstrap);
router.get('/estados', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerEstadosCama);
router.get('/sectores', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerSectores);
router.get('/total', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerTotalCamas);
router.get('/filtrar/:estado', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.filtrarCamasPorEstado);
router.get(
	'/controles-frecuentes/:numeroVisita',
	requirePermiso('INTERNACION.SIGNOS_VITALES.VER'),
	bedsController.obtenerControlesFrecuentesPorVisita,
);
router.get('/:id', requirePermiso('INTERNACION.CAMAS.VER'), bedsController.obtenerCamaPorId);
router.put('/:id/status', requirePermiso('INTERNACION.CAMAS.GESTIONAR'), bedsController.actualizarEstadoCama);

module.exports = router;
