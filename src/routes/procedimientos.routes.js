const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const procedimientosController = require('../controllers/procedimientos.controller');

router.use(requireAuth, requireTenant);

const ver = requirePermiso('INTERNACION.PROCEDIMIENTOS.VER');

router.get('/visita/:idVisita', ver, procedimientosController.listarPorVisita);

module.exports = router;
