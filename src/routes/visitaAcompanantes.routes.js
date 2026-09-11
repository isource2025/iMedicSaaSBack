const express = require('express');

const controller = require('../controllers/visitaAcompanantes.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

const router = express.Router();

router.use(requireTenant);

// Misma puerta que el resto de la gestión de visita (modal de admisión).
const permiso = requirePermiso('ADMISION.BUSQUEDA.VER');

router.get('/:numeroVisita', permiso, controller.panel);
router.post('/:numeroVisita/acompanantes', permiso, controller.agregarAcompanante);
router.delete('/:numeroVisita/acompanantes', permiso, controller.quitarAcompanante);
router.put('/:numeroVisita/observacion', permiso, controller.guardarObservacion);
router.post('/:numeroVisita/novedades', permiso, controller.agregarNovedad);
router.delete('/:numeroVisita/novedades', permiso, controller.quitarNovedad);

module.exports = router;
