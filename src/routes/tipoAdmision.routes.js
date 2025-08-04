/**
 * @fileoverview Rutas para la gestión de la tabla imTipoAdmision
 * @module routes/tipoAdmision.routes
 */

const express = require('express');
const router = express.Router();
const tipoAdmisionController = require('../controllers/tipoAdmision.controller');

/**
 * Ruta para obtener todos los registros de la tabla imTipoAdmision
 * @route GET /api/tipoadmision
 * @returns {Object} Respuesta JSON con todos los registros
 */
router.get('/', tipoAdmisionController.getTiposAdmision);

/**
 * Ruta para obtener un registro específico de la tabla imTipoAdmision por su valor
 * @route GET /api/tipoadmision/:valor
 * @param {string} valor - Valor del tipo de admisión (path parameter)
 * @returns {Object} Respuesta JSON con el registro encontrado
 */
router.get('/:valor', tipoAdmisionController.getTipoAdmision);

/**
 * Ruta para crear un nuevo registro en la tabla imTipoAdmision
 * @route POST /api/tipoadmision
 * @param {Object} body - Datos del registro a crear
 * @param {string} body.valor - Valor del tipo de admisión (char(1))
 * @param {string} body.descripcion - Descripción del tipo de admisión (varchar(40))
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.post('/', tipoAdmisionController.createTipoAdmision);

/**
 * Ruta para actualizar un registro existente en la tabla imTipoAdmision
 * @route PUT /api/tipoadmision/:valor
 * @param {string} valor - Valor del tipo de admisión a actualizar (path parameter)
 * @param {Object} body - Datos actualizados
 * @param {string} body.descripcion - Nueva descripción del tipo de admisión
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.put('/:valor', tipoAdmisionController.updateTipoAdmision);

/**
 * Ruta para eliminar un registro de la tabla imTipoAdmision
 * @route DELETE /api/tipoadmision/:valor
 * @param {string} valor - Valor del tipo de admisión a eliminar (path parameter)
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.delete('/:valor', tipoAdmisionController.deleteTipoAdmision);

module.exports = router;
