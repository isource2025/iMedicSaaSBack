const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const estudiosController = require('../controllers/estudios.controller');

router.use(requireAuth, requireTenant);

const ver = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.VER',
	'TURNOS.AGENDA.VER',
	'INTERNACION.ADJUNTOS.VER',
);
/** Lectura de KPIs/bandeja del panel (conteo y listado pendientes). */
const verBandejaPanel = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.VER',
	'TURNOS.AGENDA.VER',
	'INTERNACION.ADJUNTOS.VER',
	'DASHBOARD.INICIO.VER',
);
const crear = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.CREAR',
	'TURNOS.AGENDA.CREAR',
	'TURNOS.AGENDA.EDITAR',
);
// Responder / tomar / liberar: alcanza con VER (bandeja + notificaciones).
// CREAR/EDITAR de agenda o ADJUNTOS.CREAR siguen habilitándolo por compatibilidad.
const cumplir = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.VER',
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

router.get('/tipos/buscar', ver, estudiosController.buscarTipos);
router.get('/sectores-receptor', ver, estudiosController.listarSectores);
router.get('/pendientes/conteo', verBandejaPanel, estudiosController.contarLibres);
router.get('/pendientes', verBandejaPanel, estudiosController.listarPendientes);
router.get('/visita/:idVisita/respondidos', ver, estudiosController.respondidosResumen);
router.get('/visita/:idVisita', ver, estudiosController.listarPorVisita);
router.get('/:idPedido', ver, estudiosController.obtenerPorId);
router.post('/', crear, estudiosController.crear);
router.put('/:idPedido', editar, estudiosController.actualizar);
router.delete('/:idPedido', eliminar, estudiosController.eliminar);
router.post('/:idPedido/tomar', cumplir, estudiosController.tomar);
router.post('/:idPedido/liberar', cumplir, estudiosController.liberar);
router.post('/:idPedido/cumplir', cumplir, estudiosController.cumplir);
router.put('/:idPedido/resultado', cumplir, estudiosController.actualizarResultado);

module.exports = router;
