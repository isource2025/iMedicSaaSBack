const express = require('express');
const controller = require('../controllers/admissionSearch.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

const router = express.Router();

router.use(requireTenant);

router.get('/', requirePermiso('ADMISION.BUSQUEDA.VER'), controller.buscar);
router.get('/:numeroVisita/detail', requirePermiso('ADMISION.BUSQUEDA.VER'), controller.detalle);
router.post(
	'/:numeroVisita/export-selective',
	requirePermiso('ADMISION.BUSQUEDA.VER'),
	controller.exportSelectivo,
);

module.exports = router;
