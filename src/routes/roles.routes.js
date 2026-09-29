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

// ─── Matriz de permisos: roles personalizados de la clínica ─────────────────
// Los roles del sistema son de sólo lectura; se pueden duplicar.
const matrizCtrl = require('../controllers/rolesMatriz.controller');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.get('/matriz', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.VER'), matrizCtrl.matriz);
router.post('/', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.CREAR'), matrizCtrl.crear);
router.put('/:id(\\d+)', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.EDITAR'), matrizCtrl.actualizar);
router.post('/:id(\\d+)/duplicar', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.CREAR'), matrizCtrl.duplicar);
router.delete('/:id(\\d+)', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.ELIMINAR'), matrizCtrl.eliminar);
router.get('/:id(\\d+)/usuarios', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.VER'), matrizCtrl.usuarios);
router.get('/:id(\\d+)/auditoria', requireAuth, requireTenant, requirePermiso('CONFIGURACION.ROLES.VER'), matrizCtrl.auditoria);

module.exports = router;
