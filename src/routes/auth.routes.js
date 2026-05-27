const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Endpoint para iniciar sesión
router.post('/login', authController.inicioSesion);

// Endpoint para obtener todos los sectores
router.get('/sectores', authController.obtenerSectores);

// Endpoint para obtener sectores filtrados por usuario
router.get('/sectores/:username', authController.obtenerSectoresPorUsuario);

// Empresas asociadas al personal del usuario (imPersonalEmpresas)
router.get('/empresas/:username', authController.obtenerEmpresasPorUsuario);

module.exports = router;
