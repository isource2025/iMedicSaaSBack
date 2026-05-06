const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const ctrl = require('../controllers/permisos.controller');

router.get('/me', requireAuth, ctrl.obtenerMisPermisos);
router.get('/catalogo', requireAuth, ctrl.obtenerCatalogo);
router.get('/rol/:idRol(\\d+)', requireAuth, ctrl.obtenerPorRol);

module.exports = router;
