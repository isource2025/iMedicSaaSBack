const express = require('express');
const router = express.Router();
const localidadesController = require('../controllers/localidades.controller');

/**
 * Ruta para obtener un registro específico de la tabla localidades por el ID de la provincia
 * @route GET /api/localidad/:idProvincia
 * @param {string} idProvincia - ID de la provincia (path parameter)
 * @returns {Object} Respuesta JSON con los registros encontrados
 */
router.get('/:idProvincia', localidadesController.getLocalidades);

module.exports = router;