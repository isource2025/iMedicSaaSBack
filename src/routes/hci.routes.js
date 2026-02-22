const express = require('express');
const router = express.Router();
const hciController = require('../controllers/hci.controller');

/**
 * Rutas para Historia Clínica de Ingreso (imHCI)
 */

// GET - Obtener HC por número de visita
router.get('/visita/:numeroVisita', hciController.getByNumeroVisita);

// GET - Obtener HC por ID
router.get('/:id', hciController.getById);

// GET - Obtener HC por ID de paciente
router.get('/paciente/:idPaciente', hciController.getByIdPaciente);

// POST - Crear nueva HC
router.post('/', hciController.crear);

// PUT - Actualizar HC
router.put('/:id', hciController.actualizar);

// DELETE - Eliminar HC
router.delete('/:id', hciController.eliminar);

module.exports = router;
