// Ruta para cobertura
const express = require('express');
const router = express.Router();
const coberturaController = require('../controllers/cobertura.controller');

router.get('/list', coberturaController.getCobertura);

module.exports = router;
