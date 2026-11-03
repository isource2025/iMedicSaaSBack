const express = require('express');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { asistenteLimiter } = require('./rateLimit');
const { exigirCuota } = require('./cuota');
const controller = require('./controller');

const router = express.Router();

router.use(requireTenant);
router.use(asistenteLimiter);

/** Contrato tipo Cursor, con la sesión JWT de iMedic (no Cursor Cloud):
 *  POST /sesion → crea el agente; POST /mensaje|/mensaje/stream → un run;
 *  POST /confirmar → aplica la mutación con el usuario logueado. */

router.post('/mensaje', exigirCuota, controller.mensaje);
router.post('/mensaje/stream', exigirCuota, controller.mensajeStream);
router.post('/confirmar', controller.confirmar);
router.post('/aplicar', controller.aplicar);
router.post('/cancelar', controller.cancelar);
router.post('/sesion', controller.nuevaSesion);
router.get('/capacidades', controller.capacidades);
// Consumo IA ($/tokens) solo en superadmin: GET /api/super-admin/chats-ia*

module.exports = router;
