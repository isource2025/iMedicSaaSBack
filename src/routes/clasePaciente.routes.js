const express = require('express');
const router = express.Router();
const clasePacienteController = require('../controllers/clasePaciente.controller');

// Ruta para obtener todas las clases de paciente
router.get('/', clasePacienteController.getClasesPaciente);

// Ruta para crear una nueva clase de paciente
router.post('/', clasePacienteController.createClasePaciente);

// Ruta para actualizar una clase de paciente existente
router.put('/:Valor', clasePacienteController.updateClasePaciente);

// Ruta para eliminar una clase de paciente
router.delete('/:Valor', clasePacienteController.deleteClasePaciente);

module.exports = router;
