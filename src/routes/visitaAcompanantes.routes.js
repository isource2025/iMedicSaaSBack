const express = require('express');

const controller = require('../controllers/visitaAcompanantes.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');

const router = express.Router();

router.use(requireTenant);

// Quien crea la admisión también puede cargar acompañantes en el mismo flujo.
const permiso = requireAnyPermiso('ADMISION.BUSQUEDA.VER', 'ADMISION.NUEVA.CREAR');

router.get('/catalogos', permiso, controller.catalogos);
router.get('/:numeroVisita', permiso, controller.panel);
router.post('/:numeroVisita/acompanantes', permiso, controller.agregarAcompanante);
router.delete('/:numeroVisita/acompanantes', permiso, controller.quitarAcompanante);
router.put('/:numeroVisita/observacion', permiso, controller.guardarObservacion);
router.post('/:numeroVisita/novedades', permiso, controller.agregarNovedad);
router.delete('/:numeroVisita/novedades', permiso, controller.quitarNovedad);

module.exports = router;
