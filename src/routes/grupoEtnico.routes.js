/**
 * grupoEtnico.routes.js
 * Rutas para la gestión de la tabla imGrupoEtnico
 */
const express = require('express');
const router = express.Router();
const grupoEtnicoController = require('../controllers/grupoEtnico.controller');

// Rutas para Grupos Étnicos
router.get('/', grupoEtnicoController.getGruposEtnicos); // Obtener todos los grupos étnicos
router.get('/:valor', grupoEtnicoController.getGrupoEtnicoByValor); // Obtener un grupo étnico por su valor (PK)
router.post('/', grupoEtnicoController.createGrupoEtnico); // Crear un nuevo grupo étnico
router.put('/:valor', grupoEtnicoController.updateGrupoEtnico); // Actualizar un grupo étnico existente
router.delete('/:valor', grupoEtnicoController.deleteGrupoEtnico); // Eliminar un grupo étnico

module.exports = router;
