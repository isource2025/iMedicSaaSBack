const express = require('express');
const router = express.Router();
const localidadController = require('../controllers/localidad.controller');

/**
 * Ruta para obtener todos los registros de la tabla imLocalidades
 * @route GET /api/localidad
 * @returns {Object} Respuesta JSON con todos los registros
 */
router.get('/', localidadController.getLocalidades);

/**
 * Ruta para obtener un registro específico de la tabla imLocalidades por su valor
 * @route GET /api/localidad/:valor
 * @param {string} valor - Valor de la localidad (path parameter)
 * @returns {Object} Respuesta JSON con el registro encontrado
 */
router.get('/:valor', localidadController.getLocalidadByValor);

/**
 * Ruta para obtener un registro específico de la tabla imLocalidades por su descripción
 * @route GET /api/localidad/:valor
 * @param {string} localidad - Valor de la localidad (path parameter)
 * @returns {Object} Respuesta JSON con el registro encontrado
 */
router.get('/search-by-localidad/:localidad', localidadController.getLocalidadByDescripcion);

/**
 * Ruta para crear un nuevo registro en la tabla imLocalidades
 * @route POST /api/localidad
 * @param {Object} body - Datos del registro a crear
 * @param {string} body.valor - Valor de la localidad
 * @param {string} body.descripcion - Descripción de la localidad
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.post('/', localidadController.createLocalidad);

/**
 * Ruta para actualizar un registro existente en la tabla imLocalidades
 * @route PUT /api/localidad/:valor
 * @param {string} valor - Valor de la localidad a actualizar (path parameter)
 * @param {Object} body - Datos actualizados
 * @param {string} body.descripcion - Nueva descripción de la localidad
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.put('/:valor', localidadController.updateLocalidad);

/**
 * Ruta para eliminar un registro de la tabla imLocalidades
 * @route DELETE /api/localidad/:valor
 * @param {string} valor - Valor de la localidad a eliminar (path parameter)
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.delete('/:valor', localidadController.deleteLocalidad);

module.exports = router;
