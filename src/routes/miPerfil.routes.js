const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const miPerfilController = require('../controllers/miPerfil.controller');

router.get('/', requireAuth, miPerfilController.obtenerPerfil);
router.get('/produccion-mes/convenios', requireAuth, miPerfilController.listarConveniosProduccion);
router.get('/produccion-mes', requireAuth, miPerfilController.obtenerProduccionMes);

module.exports = router;
