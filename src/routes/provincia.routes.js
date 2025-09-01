/**
 * @fileoverview Rutas para la gestión de provincias
 * @module routes/provincia.routes
 */

const express = require('express');
const router = express.Router();
const provinciaController = require('../controllers/provincia.controller');

// Ruta para obtener todas las provincias
router.get('/', provinciaController.getProvincias);

// Ruta para obtener provincias por nacionalidad
router.get('/nacionalidad/:valorNacionalidad', provinciaController.getProvinciasByNacionalidad);

// Ruta para obtener una provincia específica
router.get('/:valor', provinciaController.getProvincia);

// Ruta para crear una nueva provincia
router.post('/', provinciaController.createProvincia);

// Ruta para actualizar una provincia existente
router.put('/:valor', provinciaController.updateProvincia);

// Ruta para eliminar una provincia
router.delete('/:valor', provinciaController.deleteProvincia);

module.exports = router;
