const express = require('express');
const router = express.Router();
const renaperController = require('../controllers/renaper.controller');

// Endpoint para genera el token
router.get('/get-token', renaperController.getToken);

// Endpoint para buscar una persona
router.get('/buscar-persona/:documento/:sexo', renaperController.search);


module.exports = router;