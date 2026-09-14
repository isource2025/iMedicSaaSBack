const express = require('express');

const controller = require('../controllers/clientesRequisitos.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

const router = express.Router();

router.use(requireTenant);

// ADMISION.TABLA solo define VER y EXPORTAR: no hay una acción de edición en la
// matriz de permisos, así que las tres rutas usan VER como el resto de los catálogos.
router.get('/coberturas', requirePermiso('ADMISION.TABLA.VER'), controller.coberturas);
router.get('/:cliente', requirePermiso('ADMISION.TABLA.VER'), controller.requisitosDeCobertura);
router.put('/:cliente', requirePermiso('ADMISION.TABLA.VER'), controller.guardarRequisitosDeCobertura);

module.exports = router;
