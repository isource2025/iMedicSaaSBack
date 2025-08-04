/**
 * estadoCivil.routes.js
 * Rutas para la gestión de la tabla imEstadoCivil
 */
const express = require('express');
const router = express.Router();
const estadoCivilController = require('../controllers/estadoCivil.controller');

// Rutas para Estados Civiles
router.get('/', estadoCivilController.getEstadosCiviles); // Obtener todos los estados civiles
router.get('/:valor', estadoCivilController.getEstadoCivilByValor); // Obtener un estado civil por su valor (PK)
router.post('/', estadoCivilController.createEstadoCivil); // Crear un nuevo estado civil
router.put('/:valor', estadoCivilController.updateEstadoCivil); // Actualizar un estado civil existente
router.delete('/:valor', estadoCivilController.deleteEstadoCivil); // Eliminar un estado civil

module.exports = router;
