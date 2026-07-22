const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const interconsultasController = require('../controllers/interconsultas.controller');

router.use(requireAuth, requireTenant);

/** Bandeja agenda + internación: médicos con TURNOS.AGENDA también ven/atienden. */
const ver = requireAnyPermiso(
	'INTERNACION.INTERCONSULTAS.VER',
	'TURNOS.AGENDA.VER',
);
const crear = requireAnyPermiso(
	'INTERNACION.INTERCONSULTAS.CREAR',
	'TURNOS.AGENDA.CREAR',
	'TURNOS.AGENDA.EDITAR',
);
const atender = requireAnyPermiso(
	'INTERNACION.INTERCONSULTAS.CREAR',
	'INTERNACION.INTERCONSULTAS.EDITAR',
	'TURNOS.AGENDA.EDITAR',
);

router.get('/sectores-destino', ver, interconsultasController.listarSectores);
router.get('/pendientes', ver, interconsultasController.listarPendientes);
router.get('/detalle/:id', ver, interconsultasController.obtenerPorId);
router.get('/:idVisita', ver, interconsultasController.listarPorVisita);
router.post('/', crear, interconsultasController.crear);
router.post('/:idPedido/tomar', atender, interconsultasController.tomar);
router.post('/:idPedido/liberar', atender, interconsultasController.liberar);
router.post('/:idPedido/cumplir', atender, interconsultasController.cumplir);

module.exports = router;
