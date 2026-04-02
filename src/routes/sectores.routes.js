const express = require('express');
const router = express.Router();
const sectoresController = require('../controllers/sectores.controller');

/**
 * Rutas para gestión de sectores
 */

// Obtener todos los sectores activos
router.get('/', sectoresController.obtenerSectores);

module.exports = router;
