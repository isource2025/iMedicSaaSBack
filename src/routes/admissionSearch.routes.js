const express = require('express');
const controller = require('../controllers/admissionSearch.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

const router = express.Router();

router.use(requireTenant);

router.get('/', requirePermiso('ADMISION.BUSQUEDA.VER'), controller.buscar);
router.get(
	'/catalogos',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.catalogosAdmision,
);
router.get(
	'/paciente/:idPaciente/turnos-activos',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.turnosActivosPaciente,
);
router.post(
	'/paciente/:idPaciente/export-general',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.exportGeneralPaciente,
);
router.get('/:numeroVisita/detail', requirePermiso('ADMISION.BUSQUEDA.VER'), controller.detalle);
router.get(
	'/:numeroVisita/datos-principales',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.datosPrincipales,
);
router.put(
	'/:numeroVisita/datos-principales',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.actualizarDatosPrincipales,
);
router.post(
	'/:numeroVisita/export-selective',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.exportSelectivo,
);

module.exports = router;
