const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/roles.controller');

// Catálogo global (Railway)
router.get('/', requireAuth, ctrl.listar);
router.get('/:id(\\d+)', requireAuth, ctrl.obtenerPorId);

// Asignación por personal (tenant clínico)
router.get('/personal/:valor(\\d+)', requireAuth, requireTenant, ctrl.obtenerDePersonal);
// Asignar roles = administrar personal: mismos permisos que las rutas de /api/personal.
router.put(
	'/personal/:valor(\\d+)',
	requireAuth,
	requireTenant,
	requireAnyPermiso(
		'CONFIGURACION.PERSONAL.CREAR',
		'CONFIGURACION.PERSONAL.EDITAR',
		'CONFIGURACION.PERSONAL.GESTIONAR',
	),
	ctrl.asignarAPersonal,
);

module.exports = router;
