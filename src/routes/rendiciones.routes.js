/**
 * Rutas para gestión de rendiciones
 */
const express = require('express');
const router = express.Router();
const rendicionesController = require('../controllers/rendiciones.controller');

// Rutas de rendiciones
router.get('/', rendicionesController.obtenerRendiciones);
router.get('/:id', rendicionesController.obtenerRendicionPorId);
router.post('/', rendicionesController.crearRendicion);
router.put('/:id', rendicionesController.actualizarRendicion);
router.delete('/:id', rendicionesController.eliminarRendicion);

module.exports = router;
