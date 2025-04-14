const express = require('express');
const router = express.Router();
const bedsController = require('../controllers/beds.controller');

// Obtiene todas las camas
router.get('/', bedsController.obtenerCamas);

// Obtiene todos los estados de cama de la tabla imEstadoCama
router.get('/estados', bedsController.obtenerEstadosCama);

// Filtra camas por su relación con estados en imestadocama
router.get('/filtro/estado/:estado', bedsController.filtrarCamasPorEstado);

// Obtiene una cama específica por su ID
router.get('/:id', bedsController.obtenerCamaPorId);

// Actualiza el estado de una cama
router.put('/:id/status', bedsController.actualizarEstadoCama);

module.exports = router;
