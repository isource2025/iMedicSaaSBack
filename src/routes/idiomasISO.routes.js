/**
 * idiomasISO.routes.js
 * Rutas para el controlador de idiomas ISO
 */
const express = require('express');
const router = express.Router();
const idiomasISOController = require('../controllers/idiomasISO.controller');

// Middleware para debug de rutas
router.use((req, res, next) => {
  console.log(`[DEBUG RUTA] Accediendo a ruta idiomas-iso: ${req.method} ${req.originalUrl}`);
  next();
});

// Rutas CRUD para imIdiomaISO (singular)
router.get('/', (req, res) => {
  console.log('[DEBUG HANDLER] Iniciando getIdiomasISO');
  idiomasISOController.getIdiomasISO(req, res);
});
router.get('/:valor', idiomasISOController.getIdiomaISOByValor);
router.post('/', idiomasISOController.createIdiomaISO);
router.put('/:valor', idiomasISOController.updateIdiomaISO);
router.delete('/:valor', idiomasISOController.deleteIdiomaISO);

module.exports = router;
