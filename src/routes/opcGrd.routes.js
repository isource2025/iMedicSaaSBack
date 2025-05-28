const express = require('express');
const router = express.Router();
const opcGrdController = require('../controllers/opcGrd.controller');
const adminMiddleware = require('../middlewares/admin.middleware');

// Aplicar el middleware de administración a todas las rutas
router.use(adminMiddleware);

/**
 * Ruta para obtener todas las opciones de grilla
 * @route GET /api/admin/opcgrd
 * @returns {Object} Respuesta JSON con todas las opciones de grilla
 */
router.get('/', opcGrdController.getAllOpcGrd);

/**
 * Ruta para obtener una opción de grilla por su ID
 * @route GET /api/admin/opcgrd/:id
 * @param {number} id - ID de la opción de grilla (path parameter)
 * @returns {Object} Respuesta JSON con la opción de grilla encontrada
 */
router.get('/:id', opcGrdController.getOpcGrdById);

/**
 * Ruta para crear una nueva opción de grilla
 * @route POST /api/admin/opcgrd
 * @param {Object} body - Datos de la opción de grilla a crear
 * @returns {Object} Respuesta JSON con la opción de grilla creada
 */
router.post('/', opcGrdController.createOpcGrd);

/**
 * Ruta para actualizar una opción de grilla existente
 * @route PUT /api/admin/opcgrd/:id
 * @param {number} id - ID de la opción de grilla a actualizar (path parameter)
 * @param {Object} body - Datos actualizados de la opción de grilla
 * @returns {Object} Respuesta JSON con la opción de grilla actualizada
 */
router.put('/:id', opcGrdController.updateOpcGrd);

/**
 * Ruta para eliminar (borrado lógico) una opción de grilla
 * @route DELETE /api/admin/opcgrd/:id
 * @param {number} id - ID de la opción de grilla a eliminar (path parameter)
 * @returns {Object} Respuesta JSON con mensaje de éxito
 */
router.delete('/:id', opcGrdController.deleteOpcGrd);

module.exports = router;
