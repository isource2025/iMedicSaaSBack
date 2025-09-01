/**
 * Rutas para la gestión de nacionalidades
 */
const express = require('express');
const nacionalidadController = require('../controllers/nacionalidad.controller');
const router = express.Router();

/**
 * @route   GET /api/nacionalidad
 * @desc    Obtener todas las nacionalidades
 * @access  Public
 */
router.get('/', nacionalidadController.getNacionalidades);

/**
 * @route   GET /api/nacionalidad/:valor
 * @desc    Obtener una nacionalidad por su valor
 * @access  Public
 */
router.get('/:valor', nacionalidadController.getNacionalidadByValor);

/**
 * @route   POST /api/nacionalidad
 * @desc    Crear una nueva nacionalidad
 * @access  Public
 */
router.post('/', nacionalidadController.createNacionalidad);

/**
 * @route   PUT /api/nacionalidad/:valor
 * @desc    Actualizar una nacionalidad existente
 * @access  Public
 */
router.put('/:valor', nacionalidadController.updateNacionalidad);

/**
 * @route   DELETE /api/nacionalidad/:valor
 * @desc    Eliminar una nacionalidad
 * @access  Public
 */
router.delete('/:valor', nacionalidadController.deleteNacionalidad);

module.exports = router;
