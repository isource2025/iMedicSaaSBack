const express = require('express');
const router = express.Router();
const estadoAmbulatorioController = require('../controllers/estadoAmbulatorio.controller');

// Ruta para obtener todos los estados ambulatorios
router.get('/', estadoAmbulatorioController.getEstadosAmbulatorios);

// Ruta para obtener un estado ambulatorio específico
router.get('/:Valor', estadoAmbulatorioController.getEstadoAmbulatorio);

// Ruta para crear un nuevo estado ambulatorio
router.post('/', estadoAmbulatorioController.createEstadoAmbulatorio);

// Ruta para actualizar un estado ambulatorio existente
router.put('/:Valor', estadoAmbulatorioController.updateEstadoAmbulatorio);

// Ruta para eliminar un estado ambulatorio
router.delete('/:Valor', estadoAmbulatorioController.deleteEstadoAmbulatorio);

module.exports = router;
