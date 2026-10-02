const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/solicitudesEstudios.controller');

router.use(requireAuth, requireTenant);

// Mismos permisos que el circuito de estudios existente.
const ver = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.VER',
	'TURNOS.AGENDA.VER',
	'INTERNACION.ADJUNTOS.VER',
);
const crear = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.CREAR',
	'TURNOS.AGENDA.CREAR',
	'TURNOS.AGENDA.EDITAR',
);
const cumplir = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.CREAR',
	'TURNOS.AGENDA.EDITAR',
	'INTERNACION.ADJUNTOS.CREAR',
);
const editar = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.EDITAR',
	'INTERNACION.ESTUDIOS.CREAR',
	'TURNOS.AGENDA.EDITAR',
);
const eliminar = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.ELIMINAR',
	'INTERNACION.ESTUDIOS.CREAR',
	'TURNOS.AGENDA.EDITAR',
);

// :clave = IdSolicitud (>0) o -IdPedido para un pedido anterior sin cabecera.
router.get('/tipos/buscar', ver, ctrl.buscarTipos);
router.get('/servicios', ver, ctrl.listarServicios);
router.get('/pendientes/conteo', ver, ctrl.contarLibres);
router.get('/pendientes', ver, ctrl.listarPendientes);
router.get('/visita/:idVisita', ver, ctrl.listarPorVisita);
router.get('/:clave', ver, ctrl.obtener);
router.post('/', crear, ctrl.crear);
router.put('/:clave', editar, ctrl.actualizar);
router.delete('/:clave', eliminar, ctrl.eliminar);
router.post('/:clave/tomar', cumplir, ctrl.tomar);
router.post('/:clave/liberar', cumplir, ctrl.liberar);
router.post('/:clave/cumplir', cumplir, ctrl.cumplir);

module.exports = router;
