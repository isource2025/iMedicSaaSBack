/**
 * Rutas de mantenimiento masivo — solo plataforma en SaaS.
 */
const express = require('express');
const router = express.Router();
const actualizacionController = require('../controllers/actualizacion.controller');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireAuth);
router.use(requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'));

router.post('/ejecutar', actualizacionController.ejecutarActualizacionMasiva);
router.get('/frecuencias', actualizacionController.verificarFrecuencias);

module.exports = router;
