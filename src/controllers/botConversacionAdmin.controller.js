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

		const result = await botConversacion.registrarMensajeSaliente({
			idConversacion: id,
			contenido,
			origen: 'AGENTE',
			idAgente: agente.idAgente,
			nombreAgente: agente.nombreAgente,
		});

		let metaEnvio = null;
		let metaError = null;
		const idEmpresa = req.idEmpresa;
		if (idEmpresa != null) {
			try {
				const cfg = await whatsappEmpresa.getConfigForEmpresa(idEmpresa);
				if (cfg?.phoneNumberId && cfg?.accessToken) {
					metaEnvio = await whatsappMeta.sendTextMessage({
						phoneNumberId: cfg.phoneNumberId,
						accessToken: cfg.accessToken,
						to: conv.telefonoWhatsApp,
						text: contenido,
					});
				}
			} catch (err) {
				metaError = err.message;
				console.warn('[enviarMensaje] Meta Graph API:', err.message);
			}
		}

		res.json({
			success: true,
			data: result,
			metaEnvio,
			metaError,
			pendienteMeta: !metaEnvio?.messageId,
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
