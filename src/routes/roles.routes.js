const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const ctrl = require('../controllers/roles.controller');

// Catálogo global (Railway)
router.get('/', requireAuth, ctrl.listar);
router.get('/:id(\\d+)', requireAuth, ctrl.obtenerPorId);

// Asignación por personal (tenant clínico)
router.get('/personal/:valor(\\d+)', requireAuth, requireTenant, ctrl.obtenerDePersonal);
router.put('/personal/:valor(\\d+)', requireAuth, requireTenant, ctrl.asignarAPersonal);

module.exports = router;
