const botConversacion = require('../services/botConversacion.service');
const whatsappEmpresa = require('../services/whatsappEmpresa.service');
const whatsappMeta = require('../services/whatsappMeta.service');
const { marcarLeidasConversacion } = require('../services/notificacionesWhatsapp.service');

function agenteDesdeReq(req) {
	const u = req.auth || {};
	return {
		idAgente: req.valorPersonal ?? u.valorPersonal ?? null,
		nombreAgente:
			[u.nombre, u.apellido].filter(Boolean).join(' ').trim() ||
			u.nombreUsuario ||
			u.username ||
			'Agente',
	};
}

async function listarConversaciones(req, res) {
	try {
		const limit = req.query.limit ? Number(req.query.limit) : 50;
		const soloNoLeidos = req.query.soloNoLeidos === '1' || req.query.soloNoLeidos === 'true';
		const data = await botConversacion.listarConversaciones({ limit, soloNoLeidos });
		res.json({ success: true, data });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function obtenerDetalle(req, res) {
	try {
		const { id } = req.params;
		const conv = await botConversacion.obtenerConversacion(id);
		if (!conv) return res.status(404).json({ success: false, mensaje: 'Conversación no encontrada' });
		const mensajes = await botConversacion.listarMensajes(id, { limit: 100 });
		res.json({ success: true, data: { conversacion: conv, mensajes } });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function listarMensajes(req, res) {
	try {
		const { id } = req.params;
		const desdeId = req.query.desdeId ? Number(req.query.desdeId) : null;
		const limit = req.query.limit ? Number(req.query.limit) : 100;
		const mensajes = await botConversacion.listarMensajes(id, { limit, desdeId });
		res.json({ success: true, data: mensajes });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function marcarLeida(req, res) {
	try {
		const conv = await botConversacion.marcarLeida(req.params.id);
		const vp = req.valorPersonal ?? req.auth?.valorPersonal;
		if (vp) {
			marcarLeidasConversacion(req.params.id, vp).catch(() => {});
		}
		res.json({ success: true, data: conv });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function contarNoLeidos(req, res) {
	try {
		const total = await botConversacion.contarMensajesNoLeidos();
		res.json({ success: true, data: { total, almacenamiento: 'sql' } });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function cambiarControl(req, res) {
	try {
		const { modo } = req.body || {};
		const conv = await botConversacion.cambiarModoControl(
			req.params.id,
			modo,
			agenteDesdeReq(req),
		);
		res.json({ success: true, data: conv });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function enviarMensaje(req, res) {
	try {
		const { contenido } = req.body || {};
		const id = req.params.id;
		const texto = String(contenido || '').trim();
		if (!texto) {
			return res.status(400).json({ success: false, mensaje: 'El mensaje no puede estar vacío' });
		}

		const conv = await botConversacion.obtenerConversacion(id);
		if (!conv) return res.status(404).json({ success: false, mensaje: 'Conversación no encontrada' });

		if (conv.modoControl === 'BOT') {
			return res.status(409).json({
				success: false,
				mensaje: 'El bot está activo. Pausalo o tomá el control antes de enviar mensajes.',
				codigo: 'BOT_ACTIVO',
			});
		}

		const agente = agenteDesdeReq(req);
		if (conv.modoControl === 'PAUSADO') {
			await botConversacion.cambiarModoControl(id, 'HUMANO', agente);
		}

		const idEmpresa = req.idEmpresa;
		if (idEmpresa == null) {
			return res.status(400).json({
				success: false,
				mensaje: 'No hay empresa en la sesión; no se puede enviar a WhatsApp',
				codigo: 'SIN_EMPRESA',
			});
		}

		const cfg = await whatsappEmpresa.getConfigForEmpresa(idEmpresa);
		if (!cfg?.phoneNumberId || !cfg?.accessToken) {
			return res.status(503).json({
				success: false,
				mensaje:
					'WhatsApp no está configurado para esta empresa (Phone Number ID / Access Token). Revisá Super Admin o variables Meta.',
				codigo: 'WHATSAPP_NO_CONFIG',
			});
		}

		let metaEnvio;
		try {
			metaEnvio = await whatsappMeta.sendTextMessage({
				phoneNumberId: cfg.phoneNumberId,
				accessToken: cfg.accessToken,
				to: conv.telefonoWhatsApp,
				text: texto,
			});
		} catch (err) {
			console.warn('[enviarMensaje] Meta Graph API:', err.message);
			return res.status(502).json({
				success: false,
				mensaje:
					err.message ||
					'WhatsApp rechazó el mensaje (token, número o ventana de 24 h). No se guardó como enviado.',
				codigo: 'META_SEND_FAILED',
				metaError: err.message,
			});
		}

		if (!metaEnvio?.messageId) {
			return res.status(502).json({
				success: false,
				mensaje: 'WhatsApp no devolvió ID de mensaje. No se guardó como enviado.',
				codigo: 'META_NO_MESSAGE_ID',
				metaEnvio,
			});
		}

		const result = await botConversacion.registrarMensajeSaliente({
			idConversacion: id,
			contenido: texto,
			origen: 'AGENTE',
			idAgente: agente.idAgente,
			nombreAgente: agente.nombreAgente,
			metaMessageId: metaEnvio.messageId,
		});

		res.json({
			success: true,
			data: { ...result, pendienteMeta: false, metaEnvio },
		});
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

/** Simula mensaje entrante del paciente (testing sin Meta) */
async function simularEntrante(req, res) {
	try {
		const { telefono, mensaje, nombreContacto, idConversacion } = req.body || {};
		if (!telefono || !mensaje) {
			return res.status(400).json({
				success: false,
				mensaje: 'telefono y mensaje son obligatorios',
			});
		}
		const result = await botConversacion.registrarMensajeEntrante({
			telefonoWhatsApp: telefono,
			contenido: mensaje,
			idConversacion,
			nombreContacto,
		});
		res.json({ success: true, data: result });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function estadoAlmacenamiento(req, res) {
	try {
		const sqlOk = await botConversacion.checkConversationTables();
		const botChat = await require('../services/botChatStorage.service').tableExists();
		res.json({
			success: true,
			data: {
				tablasSql: sqlOk,
				almacenamiento: sqlOk ? 'sql' : 'memoria',
				esquema: botChat ? 'imBotChat' : 'legacy',
			},
		});
	} catch (err) {
		res.status(err.statusCode || 503).json({
			success: false,
			mensaje: err.message,
			codigo: err.codigo || 'BOT_CONVERSACIONES_SIN_SQL',
		});
	}
}

module.exports = {
	listarConversaciones,
	obtenerDetalle,
	listarMensajes,
	marcarLeida,
	cambiarControl,
	enviarMensaje,
	simularEntrante,
	estadoAlmacenamiento,
	contarNoLeidos,
};
