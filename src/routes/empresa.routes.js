/**
 * Rutas para la gestión de información de la empresa
 */
const express = require('express');
const router = express.Router();
const empresaController = require('../controllers/empresa.controller');

/**
 * @route GET /api/empresa
 * @desc Obtener información de la empresa
 * @access Public
 */
router.get('/', empresaController.obtenerInfoEmpresa);

module.exports = router;
