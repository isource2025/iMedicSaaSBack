const express = require('express');
const router = express.Router();
const provinciasController = require('../controllers/provincias.controller');

/**
 * Ruta para obtener un registro específico de la tabla localidades por el ID de la provincia
 * @route GET /api/localidad/:idProvincia
 *  * @param {string} letraProvincia - ID de la provincia (path parameter)
 * @returns {Object} Respuesta JSON con los registros encontrados
 */
router.get('/:letraProvincia', provinciasController.getProvinciaPorLetra);

module.exports = router;