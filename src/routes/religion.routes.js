/**
 * @fileoverview Rutas para la gestión de religiones
 * @module routes/religion.routes
 */

const express = require('express');
const router = express.Router();
const religionController = require('../controllers/religion.controller');

// Ruta para obtener todas las religiones
router.get('/', religionController.getReligiones);

// Ruta para obtener una religión específica
router.get('/:valor', religionController.getReligion);

// Ruta para crear una nueva religión
router.post('/', religionController.createReligion);

// Ruta para actualizar una religión existente
router.put('/:valor', religionController.updateReligion);

// Ruta para eliminar una religión
router.delete('/:valor', religionController.deleteReligion);

module.exports = router;
