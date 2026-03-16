const express = require('express');
const router = express.Router();
const signosVitalesController = require('../controllers/signosVitales.controller');

/**
 * Rutas para Signos Vitales
 * Integración entre Historia Clínica y Controles de Enfermería
 */

/**
 * POST /api/signos-vitales
 * Guarda signos vitales con doble guardado automático
 * Body: { NumeroVisita, IdHCIngreso?, medibles, antropometricos, OperadorCarga, Profesional, IdSector? }
 */
router.post('/', signosVitalesController.guardarSignosVitales);

/**
 * GET /api/signos-vitales/:idHCIngreso
 * Obtiene signos vitales completos (HC + Control asociado)
 */
router.get('/:idHCIngreso', signosVitalesController.obtenerSignosVitales);

module.exports = router;
