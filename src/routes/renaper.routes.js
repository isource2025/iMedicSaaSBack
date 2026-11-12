const express = require('express');
const router = express.Router();
const renaperController = require('../controllers/renaper.controller');

// Endpoint para genera el token
router.get('/get-token', renaperController.getToken);

// Buscar persona por DNI; el sexo es opcional (sin sexo devuelve todas las personas del DNI)
router.get('/buscar-persona/:documento/:sexo?', renaperController.search);


module.exports = router;