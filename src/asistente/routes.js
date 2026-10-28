const express = require('express');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
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
router.get('/consumo', requirePermiso('CONFIGURACION.CONSUMO_IA.VER'), controller.reporteConsumo);
router.get('/consumo/mensajes', requirePermiso('CONFIGURACION.CONSUMO_IA.VER'), controller.consumoMensajes);

module.exports = router;
