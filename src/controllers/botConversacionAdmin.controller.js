const botConversacion = require('../services/botConversacion.service');

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
		res.json({ success: true, data: conv });
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

		res.json({
			success: true,
			data: result,
			pendienteMeta: true,
			nota: 'Mensaje registrado. Al conectar Meta Cloud API, el envío real se hará vía webhook saliente.',
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
		const sql = await botConversacion.checkConversationTables();
		res.json({
			success: true,
			data: {
				tablasSql: sql,
				almacenamiento: sql ? 'sql' : 'memoria',
			},
		});
	} catch (err) {
		res.status(500).json({ success: false, mensaje: err.message });
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
};
