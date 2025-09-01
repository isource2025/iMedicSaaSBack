const express = require('express');
const router = express.Router();
const localidadesController = require('../controllers/localidades.controller');

/**
 * Ruta para obtener un registro específico de la tabla localidades por el ID de la provincia
 * @route GET /api/localidad/:idProvincia
 * @returns {Object} Respuesta JSON con los registros encontrados
 */
router.get('/', localidadesController.getLocalidades);

module.exports = router;