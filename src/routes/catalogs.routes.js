const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const catalogsController = require('../controllers/catalogs.controller');

router.use(requireAuth, requireTenant);

/**
 * Ruta para obtener las disposiciones de egreso
 * @route GET /api/catalogs/disposiciones-egreso
 * @returns {Object} Respuesta JSON con las disposiciones de egreso
 */
router.get('/disposiciones-egreso', catalogsController.getDisposicionesEgreso);

/**
 * Ruta para obtener todos los diagnósticos CIE10
 * @route GET /api/catalogs/diagnosticos
 * @returns {Object} Respuesta JSON con todos los diagnósticos CIE10
 */
router.get('/diagnosticos', catalogsController.getDiagnosticosCie10);

/**
 * Ruta para buscar diagnósticos CIE10 por término (código o descripción)
 * @route GET /api/catalogs/diagnosticos/buscar
 * @param {string} termino - Término de búsqueda (query parameter)
 * @returns {Object} Respuesta JSON con los diagnósticos que coinciden con el término
 */
router.get('/diagnosticos/buscar', catalogsController.buscarDiagnosticosCie10);

/**
 * Ruta para obtener un diagnóstico CIE10 por su ID
 * @route GET /api/catalogs/diagnosticos/:id
 * @param {number} id - ID del diagnóstico (path parameter)
 * @returns {Object} Respuesta JSON con el diagnóstico encontrado
 */
router.get('/diagnosticos/:id', catalogsController.getDiagnosticoPorId);



module.exports = router;
