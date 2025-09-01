const express = require('express');
const router = express.Router();
const estadosAmbulatoriosController = require('../controllers/estadosAmbulatoriosController');

// Ruta para obtener todos los estados ambulatorios
router.get('/', estadosAmbulatoriosController.getAll);

// Ruta para obtener un estado ambulatorio por su valor
router.get('/:valor', estadosAmbulatoriosController.getByValor);

module.exports = router;
