/**
 * estadoMilitar.routes.js
 * Rutas para la gestión de la tabla imEstadoMilitar
 */
const express = require('express');
const router = express.Router();
const estadoMilitarController = require('../controllers/estadoMilitar.controller');

// Rutas para Estados Militares
router.get('/', estadoMilitarController.getEstadosMilitares); // Obtener todos los estados militares
router.get('/:valor', estadoMilitarController.getEstadoMilitarByValor); // Obtener un estado militar por su valor (PK)
router.post('/', estadoMilitarController.createEstadoMilitar); // Crear un nuevo estado militar
router.put('/:valor', estadoMilitarController.updateEstadoMilitar); // Actualizar un estado militar existente
router.delete('/:valor', estadoMilitarController.deleteEstadoMilitar); // Eliminar un estado militar

module.exports = router;
