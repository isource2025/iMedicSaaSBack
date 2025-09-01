/**
 * @fileoverview Rutas para la gestión de roles de contacto
 * @module routes/rolContacto.routes
 */

const express = require('express');
const router = express.Router();
const rolContactoController = require('../controllers/rolContacto.controller');

// Ruta para obtener todos los roles de contacto
router.get('/', rolContactoController.getRolesContacto);

// Ruta para obtener un rol de contacto específico
router.get('/:valor', rolContactoController.getRolContacto);

// Ruta para crear un nuevo rol de contacto
router.post('/', rolContactoController.createRolContacto);

// Ruta para actualizar un rol de contacto existente
router.put('/:valor', rolContactoController.updateRolContacto);

// Ruta para eliminar un rol de contacto
router.delete('/:valor', rolContactoController.deleteRolContacto);

module.exports = router;
