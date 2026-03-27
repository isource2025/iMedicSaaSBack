const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');

// Obtener todos los usuarios
router.get('/', usersController.obtenerUsuarios);

// Obtener un usuario por ID
router.get('/:id', usersController.obtenerUsuario);

// Crear un nuevo usuario
router.post('/', usersController.crearUsuario);

// Actualizar datos de un usuario
router.put('/:id', usersController.actualizarUsuario);

// Cambiar contraseña de un usuario
router.put('/:id/password', usersController.cambiarPassword);

// Asignar sector a un usuario
router.post('/:id/sectores', usersController.asignarSector);

// Quitar sector de un usuario
router.delete('/:id/sectores/:idSector', usersController.quitarSector);

module.exports = router;
