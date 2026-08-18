const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const estudiosController = require('../controllers/estudios.controller');

router.use(requireAuth, requireTenant);

const ver = requireAnyPermiso('INTERNACION.ESTUDIOS.VER', 'TURNOS.AGENDA.VER');
const crear = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.CREAR',
	'TURNOS.AGENDA.CREAR',
	'TURNOS.AGENDA.EDITAR',
);
const cumplir = requireAnyPermiso('INTERNACION.ESTUDIOS.CREAR', 'TURNOS.AGENDA.EDITAR');
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
router.get('/pendientes', ver, estudiosController.listarPendientes);
router.get('/visita/:idVisita', ver, estudiosController.listarPorVisita);
router.get('/:idPedido', ver, estudiosController.obtenerPorId);
router.post('/', crear, estudiosController.crear);
router.put('/:idPedido', editar, estudiosController.actualizar);
router.delete('/:idPedido', eliminar, estudiosController.eliminar);
router.post('/:idPedido/tomar', cumplir, estudiosController.tomar);
router.post('/:idPedido/liberar', cumplir, estudiosController.liberar);
router.post('/:idPedido/cumplir', cumplir, estudiosController.cumplir);

module.exports = router;
