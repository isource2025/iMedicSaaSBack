const express = require('express');
const router = express.Router();
const bedsController = require('../controllers/beds.controller');

// Obtiene todas las camas
router.get('/', bedsController.obtenerCamas);

// Obtiene todos los estados de cama de la tabla imEstadoCama
router.get('/estados', bedsController.obtenerEstadosCama);

// Obtiene todos los sectores de la tabla imSectores
router.get('/sectores', bedsController.obtenerSectores);

// Obtiene el total de camas y estadísticas
router.get('/total', bedsController.obtenerTotalCamas);

// Filtra camas por su relación con estados en imestadocama
router.get('/filtrar/:estado', bedsController.filtrarCamasPorEstado);

// Obtiene los controles frecuentes por número de visita
router.get('/controles-frecuentes/:numeroVisita', bedsController.obtenerControlesFrecuentesPorVisita);

// Obtiene una cama específica por su ID
router.get('/:id', bedsController.obtenerCamaPorId);

// Actualiza el estado de una cama
router.put('/:id/status', bedsController.actualizarEstadoCama);

module.exports = router;