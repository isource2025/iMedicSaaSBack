const express = require('express');
const router = express.Router();
const sexoController = require('../controllers/sexo.controller');

/**
 * Ruta para obtener todos los registros de la tabla imSexo
 * @route GET /api/sexo
 * @returns {Object} Respuesta JSON con todos los registros
 */
router.get('/', sexoController.getSexos);

/**
 * Ruta para obtener un registro específico de la tabla imSexo por su valor
 * @route GET /api/sexo/:valor
 * @param {string} valor - Valor del sexo (path parameter)
 * @returns {Object} Respuesta JSON con el registro encontrado
 */
router.get('/:valor', sexoController.getSexoByValor);

/**
 * Ruta para crear un nuevo registro en la tabla imSexo
 * @route POST /api/sexo
 * @param {Object} body - Datos del registro a crear
 * @param {string} body.valor - Valor del sexo (char(1))
 * @param {string} body.descripcion - Descripción del sexo (varchar(15))
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.post('/', sexoController.createSexo);

/**
 * Ruta para actualizar un registro existente en la tabla imSexo
 * @route PUT /api/sexo/:valor
 * @param {string} valor - Valor del sexo a actualizar (path parameter)
 * @param {Object} body - Datos actualizados
 * @param {string} body.descripcion - Nueva descripción del sexo
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.put('/:valor', sexoController.updateSexo);

/**
 * Ruta para eliminar un registro de la tabla imSexo
 * @route DELETE /api/sexo/:valor
 * @param {string} valor - Valor del sexo a eliminar (path parameter)
 * @returns {Object} Respuesta JSON con el resultado de la operación
 */
router.delete('/:valor', sexoController.deleteSexo);

module.exports = router;
