const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/permisos.controller');

router.get('/me', requireAuth, ctrl.obtenerMisPermisos);
router.get('/catalogo', requireAuth, ctrl.obtenerCatalogo);
router.get('/rol/:idRol(\\d+)', requireAuth, ctrl.obtenerPorRol);

// Overrides por persona (misma autorización que asignar roles)
const puedePersonal = requireAnyPermiso(
	'CONFIGURACION.PERSONAL.CREAR',
	'CONFIGURACION.PERSONAL.EDITAR',
	'CONFIGURACION.PERSONAL.GESTIONAR',
);

router.post('/personal/preview', requireAuth, requireTenant, puedePersonal, ctrl.previewBase);
router.get('/personal/:valor(\\d+)', requireAuth, requireTenant, puedePersonal, ctrl.obtenerDePersonal);
router.put('/personal/:valor(\\d+)', requireAuth, requireTenant, puedePersonal, ctrl.guardarDePersonal);

module.exports = router;
