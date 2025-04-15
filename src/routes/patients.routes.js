const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');

// Obtiene todos los pacientes
router.get('/', patientsController.obtenerPacientes);

// Busca pacientes por nombre o número de documento
router.get('/search', patientsController.buscarPacientes);

// Obtiene un paciente específico por su ID
router.get('/:id', patientsController.obtenerPacientePorId);

// Crea un nuevo paciente
router.post('/', patientsController.crearPaciente);

// Actualiza un paciente existente
router.put('/:id', patientsController.actualizarPaciente);

// Elimina un paciente
router.delete('/:id', patientsController.eliminarPaciente);

module.exports = router;
