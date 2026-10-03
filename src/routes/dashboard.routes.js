const express = require('express');
const router = express.Router();
const { obtenerResumen } = require('../controllers/dashboard.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

// Un solo viaje para el panel de inicio; cada sección se filtra por permiso dentro del servicio.
router.get('/resumen', requirePermiso('DASHBOARD.INICIO.VER'), obtenerResumen);

module.exports = router;
