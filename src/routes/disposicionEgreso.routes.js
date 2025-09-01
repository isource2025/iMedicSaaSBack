const express = require('express');
const router = express.Router();
const disposicionEgresoController = require('../controllers/disposicionEgreso.controller');

// Ruta para obtener todas las disposiciones de egreso
router.get('/', disposicionEgresoController.getDisposicionesEgreso);

// Ruta para crear una nueva disposición de egreso
router.post('/', disposicionEgresoController.createDisposicionEgreso);

// Ruta para actualizar una disposición de egreso existente
router.put('/:Valor', disposicionEgresoController.updateDisposicionEgreso);

// Ruta para eliminar una disposición de egreso
router.delete('/:Valor', disposicionEgresoController.deleteDisposicionEgreso);

module.exports = router;
