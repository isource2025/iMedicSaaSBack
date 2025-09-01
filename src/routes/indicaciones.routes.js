const express = require('express');
const router = express.Router();
const indicacionesController = require('../controllers/indicaciones.controller');

// Última indicación por número de visita
router.get('/ultima/:numeroVisita', indicacionesController.obtenerUltimaIndicacionPorVisita);

// Últimas N indicaciones por número de visita (?limit=3 por defecto)
router.get('/ultimas/:numeroVisita', indicacionesController.obtenerUltimasIndicacionesPorVisita);

module.exports = router;
