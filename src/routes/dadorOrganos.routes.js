const express = require('express');
const router = express.Router();
const dadorOrganosController = require('../controllers/dadorOrganos.controller');

// Ruta para obtener todos los registros de dador de órganos
router.get('/', dadorOrganosController.getDadoresOrganos);

// Ruta para crear un nuevo registro de dador de órganos
router.post('/', dadorOrganosController.createDadorOrganos);

// Ruta para actualizar un registro de dador de órganos existente
router.put('/:Valor', dadorOrganosController.updateDadorOrganos);

// Ruta para eliminar un registro de dador de órganos
router.delete('/:Valor', dadorOrganosController.deleteDadorOrganos);

module.exports = router;
