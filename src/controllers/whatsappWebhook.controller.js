const whatsappWebhook = require('../services/whatsappWebhook.service');
const whatsappMeta = require('../services/whatsappMeta.service');
const diag = require('../utils/diagLog');

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
	diag.logWebhookIncoming(req);
	try {
		whatsappMeta.verificarFirmaWebhook(req);
		const result = await whatsappWebhook.procesarWebhookEntrante(req.body);
		diag.logWebhookProcess(result, req.body);
		if (result.procesados > 0) {
			console.log(
				`[whatsapp] ${result.procesados} mensaje(s) → empresa(s) ${result.empresas.join(', ')}`,
			);
		} else if (result.skipped) {
			diag.line('webhook', 'Sin mensajes de texto en payload', {
				reason: result.skipped,
				entryCount: req.body?.entry?.length ?? 0,
			});
		}
		return res.status(200).json({ success: true });
	} catch (err) {
		if (err.statusCode === 401) {
			console.warn('[whatsapp] Firma inválida:', err.message);
			return res.status(401).json({ success: false, mensaje: err.message });
		}
		diag.warn('webhook', 'Error procesando', { error: err.message, code: err.code });
		console.error('[whatsapp] Error procesando webhook:', err.message);
		// Meta reintenta si no es 200; respondemos 200 igual para evitar loops en errores de BD.
		return res.status(200).json({ success: false });
	}
}

module.exports = { verificar, recibirEventos };
