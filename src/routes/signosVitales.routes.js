const express = require('express');
const router = express.Router();
const signosVitalesController = require('../controllers/signosVitales.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.post('/', requirePermiso('INTERNACION.SIGNOS_VITALES.CREAR'), signosVitalesController.guardarSignosVitales);
router.get(
	'/:idHCIngreso',
	requirePermiso('INTERNACION.SIGNOS_VITALES.VER'),
	signosVitalesController.obtenerSignosVitales,
);

module.exports = router;
