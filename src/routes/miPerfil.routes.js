const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const miPerfilController = require('../controllers/miPerfil.controller');
const { passwordChangeLimiter } = require('../middlewares/rateLimit.middleware');

router.use(requireAuth, requireTenant);
router.get('/', miPerfilController.obtenerPerfil);
router.put('/', miPerfilController.rechazarCambio);
router.put('/password', passwordChangeLimiter, miPerfilController.cambiarPassword);
router.get('/foto', miPerfilController.obtenerFotoPerfil);
router.put('/foto', miPerfilController.rechazarCambio);
router.delete('/foto', miPerfilController.rechazarCambio);
router.get('/produccion-mes/convenios', miPerfilController.listarConveniosProduccion);
router.get('/produccion-mes', miPerfilController.obtenerProduccionMes);

module.exports = router;
