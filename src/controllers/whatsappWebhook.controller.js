const whatsappWebhook = require('../services/whatsappWebhook.service');

/**
 * GET /api/webhook/whatsapp
 * Meta — verificación (hub.verify_token + hub.challenge).
 */
function verificar(req, res) {
	try {
		const { challenge } = whatsappWebhook.verificarSuscripcion(req.query);
		console.log('[whatsapp] Webhook verificado correctamente');
		return res.status(200).send(challenge);
	} catch (err) {
		console.warn('[whatsapp] Verificación fallida:', err.message);
		return res.status(err.statusCode || 403).send(err.message);
	}
}

/**
 * POST /api/webhook/whatsapp
 * Meta — eventos entrantes (mensajes, etc.).
 */
async function recibirEventos(req, res) {
	try {
		// Meta espera 200 rápido; procesamos en la misma request por ahora.
		const result = await whatsappWebhook.procesarWebhookEntrante(req.body);
		if (result.procesados > 0) {
			console.log(`[whatsapp] ${result.procesados} mensaje(s) registrado(s)`);
		}
		return res.status(200).json({ success: true });
	} catch (err) {
		console.error('[whatsapp] Error procesando webhook:', err.message);
		// Meta reintenta si no es 200; respondemos 200 igual para evitar loops en errores de BD.
		return res.status(200).json({ success: false });
	}
}

module.exports = { verificar, recibirEventos };
