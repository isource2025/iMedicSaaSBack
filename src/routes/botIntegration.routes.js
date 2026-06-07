const express = require('express');
const router = express.Router();
const { requireBotApiKey } = require('../middlewares/botApiKey.middleware');
const ctrl = require('../controllers/botIntegration.controller');
const convCtrl = require('../controllers/botConversacionWebhook.controller');

router.use(requireBotApiKey);

/** Webhooks conversación — Meta / middleware WhatsApp */
router.post('/webhook/mensaje', convCtrl.webhookMensajeEntrante);
router.post('/webhook/mensaje-saliente', convCtrl.webhookMensajeSaliente);
router.get('/conversaciones/estado', convCtrl.consultarEstado);
router.patch('/conversaciones/contexto', convCtrl.actualizarContexto);

router.get('/config', ctrl.obtenerConfig);

/** Puerta de entrada: solo DNI → RENAPER (sexo automático) + ficha local */
router.post('/identificar', ctrl.identificar);
router.get('/identificar', (req, res, next) => {
	req.body = {
		numeroDocumento: req.query.dni ?? req.query.numeroDocumento,
		sexo: req.query.sexo,
		telefonoWhatsApp: req.query.telefonoWhatsApp ?? req.query.telefono,
		crearSiNoExiste: req.query.crearSiNoExiste === 'true' || req.query.crearSiNoExiste === '1',
		idConversacion: req.query.idConversacion,
	};
	return ctrl.identificar(req, res, next);
});

router.get('/especialidades', ctrl.especialidades);
router.get('/profesionales', ctrl.profesionales);

router.get('/pacientes/buscar', ctrl.buscarPacientes);
router.post('/pacientes', ctrl.crearPaciente);

router.get('/disponibilidad', ctrl.disponibilidad);

router.post('/turnos/reservar', ctrl.reservar);
router.get('/turnos/:idTurno/ticket', ctrl.ticketTurno);
router.get('/turnos/paciente', ctrl.turnosPaciente);
router.post('/turnos/cancelar', ctrl.cancelar);

module.exports = router;
