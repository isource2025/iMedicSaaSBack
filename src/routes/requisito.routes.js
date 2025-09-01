/**
 * @fileoverview Rutas para la gestión de requisitos de clientes
 * @module routes/requisito.routes
 */

const express = require('express');
const router = express.Router();
const requisitoController = require('../controllers/requisito.controller');

// Ruta para obtener todos los requisitos
router.get('/', requisitoController.getRequisitos);

// Ruta para obtener un requisito específico
router.get('/:valor', requisitoController.getRequisito);

// Ruta para crear un nuevo requisito
router.post('/', requisitoController.createRequisito);

// Ruta para actualizar un requisito existente
router.put('/:valor', requisitoController.updateRequisito);

// Ruta para eliminar un requisito
router.delete('/:valor', requisitoController.deleteRequisito);

module.exports = router;
