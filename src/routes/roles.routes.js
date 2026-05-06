const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const ctrl = require('../controllers/roles.controller');

// Catálogo
router.get('/', requireAuth, ctrl.listar);
router.get('/:id(\\d+)', requireAuth, ctrl.obtenerPorId);

// Rol asignado a un personal
router.get('/personal/:valor(\\d+)', requireAuth, ctrl.obtenerDePersonal);
router.put('/personal/:valor(\\d+)', requireAuth, ctrl.asignarAPersonal);

module.exports = router;
