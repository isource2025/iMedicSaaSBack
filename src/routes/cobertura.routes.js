// Ruta para cobertura
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const coberturaController = require('../controllers/cobertura.controller');

router.use(requireAuth, requireTenant);
router.get('/list', coberturaController.getCobertura);
router.get('/validar-afiliado/:documento', coberturaController.validarAfiliado);

module.exports = router;
