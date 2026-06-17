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
 * Responde 200 de inmediato para evitar reintentos de Meta mientras GPT procesa.
 */
async function recibirEventos(req, res) {
	diag.logWebhookIncoming(req);
	const msgCount = (req.body?.entry || []).reduce((n, e) => {
		for (const c of e.changes || []) {
			n += (c.value?.messages || []).length;
		}
		return n;
	}, 0);
	console.log(
		`[whatsapp] POST webhook (${msgCount} mensaje(s), object=${req.body?.object || '?'})`,
	);
	if (msgCount > 0) {
		const tipos = [];
		for (const entry of req.body?.entry || []) {
			for (const change of entry.changes || []) {
				for (const m of change.value?.messages || []) {
					tipos.push(m.type || '?');
				}
			}
		}
		console.log(`[whatsapp] tipos: ${tipos.join(', ')} | UA: ${String(req.headers['user-agent'] || '').slice(0, 40)}`);
	}
	try {
		whatsappMeta.verificarFirmaWebhook(req);
	} catch (err) {
		if (err.statusCode === 401) {
			console.error(
				'[whatsapp] Firma inválida — Meta descartó el mensaje. En Railway: WHATSAPP_WEBHOOK_TRUST_META_UA=1 (o redeploy con trust prod por defecto).',
				err.message,
			);
			return res.status(401).json({ success: false, mensaje: err.message });
		}
		diag.warn('webhook', 'Error verificando firma', { error: err.message, code: err.code });
		console.error('[whatsapp] Error verificando webhook:', err.message);
		return res.status(200).json({ success: false });
	}

	const body = req.body;
	res.status(200).json({ success: true });

	setImmediate(() => {
		whatsappWebhook
			.procesarWebhookEntrante(body)
			.then((result) => {
				diag.logWebhookProcess(result, body);
				if (result.procesados > 0) {
					console.log(
						`[whatsapp] ${result.procesados} mensaje(s) → empresa(s) ${result.empresas.join(', ')}`,
					);
				} else if (result.skipped) {
					diag.line('webhook', 'Sin mensajes de texto en payload', {
						reason: result.skipped,
						entryCount: body?.entry?.length ?? 0,
					});
				}
			})
			.catch((err) => {
				diag.warn('webhook', 'Error procesando (async)', {
					error: err.message,
					code: err.code,
				});
				console.error('[whatsapp] Error procesando webhook (async):', err.message);
			});
	});
}

module.exports = { verificar, recibirEventos };
