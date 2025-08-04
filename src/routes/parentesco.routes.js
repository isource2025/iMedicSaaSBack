/**
 * @fileoverview Rutas para la gestión de parentescos
 * @module routes/parentesco.routes
 */

const express = require('express');
const router = express.Router();
const parentescoController = require('../controllers/parentesco.controller');

// Rutas para gestión de parentescos
router.get('/', parentescoController.getParentescos);
router.get('/:valor', parentescoController.getParentesco);
router.post('/', parentescoController.createParentesco);
router.put('/:valor', parentescoController.updateParentesco);
router.delete('/:valor', parentescoController.deleteParentesco);

module.exports = router;
