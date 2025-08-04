const express = require('express');
const router = express.Router();
const diagnosticoController = require('../controllers/diagnostico.controller');

// Ruta para obtener todos los diagnósticos
router.get('/', diagnosticoController.getDiagnosticos);

// Ruta para crear un nuevo diagnóstico
router.post('/', diagnosticoController.createDiagnostico);

// Ruta para actualizar un diagnóstico existente
router.put('/:Valor', diagnosticoController.updateDiagnostico);

// Ruta para eliminar un diagnóstico
router.delete('/:Valor', diagnosticoController.deleteDiagnostico);

module.exports = router;
