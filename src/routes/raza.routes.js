/**
 * @fileoverview Rutas para la gestión de razas
 * @module routes/raza.routes
 */

const express = require('express');
const router = express.Router();
const razaController = require('../controllers/raza.controller');

// Ruta para obtener todas las razas
router.get('/', razaController.getRazas);

// Ruta para obtener una raza específica
router.get('/:valor', razaController.getRaza);

// Ruta para crear una nueva raza
router.post('/', razaController.createRaza);

// Ruta para actualizar una raza existente
router.put('/:valor', razaController.updateRaza);

// Ruta para eliminar una raza
router.delete('/:valor', razaController.deleteRaza);

module.exports = router;
