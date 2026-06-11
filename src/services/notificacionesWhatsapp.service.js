const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');

/**
 * Destinatarios de avisos WhatsApp (inbox agenda).
 * - NOTIFICACIONES_WHATSAPP_VALOR_PERSONAL_LIST=12,34
 * - Si no: todos los operadores activos (MarcadeBaja = 0).
 */
async function obtenerDestinatariosWhatsApp() {
	const raw = process.env.NOTIFICACIONES_WHATSAPP_VALOR_PERSONAL_LIST;
	if (raw && String(raw).trim()) {
		return String(raw)
			.split(',')
			.map((s) => parseInt(s.trim(), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
	}

	const rows = await executeQuery(
		`
		SELECT p.ValorPersonal
		FROM dbo.imPassword p
		WHERE ISNULL(p.MarcadeBaja, 0) = 0
		`,
		[],
	);
	return (rows || []).map((r) => r.ValorPersonal).filter(Boolean);
}

/**
 * Crea notificaciones en imNotificaciones por mensaje entrante (no bloquea el webhook).
 */
async function notificarMensajeWhatsAppEntrante({
	idConversacion,
	telefono,
	nombreContacto,
	contenido,
	idMensaje,
}) {
	try {
		const { resolveImNotificacionesColumns } = require('./notificacionesColumns');
		const cols = await resolveImNotificacionesColumns();
		if (!cols.usable) return;

		const destinatarios = await obtenerDestinatariosWhatsApp();
		if (!destinatarios.length) {
			console.log('[notif whatsapp] Sin destinatarios configurados o activos.');
			return;
		}

		const quien = nombreContacto || `+${telefono}`;
		const preview = String(contenido || '').replace(/\s+/g, ' ').trim().slice(0, 120);
		const descripcion = `WhatsApp · ${quien}: ${preview}`.substring(0, 250);
		const datos = {
			idConversacion,
			telefono,
			nombreContacto,
			idMensaje,
			ruta: '/dashboard/turnos/chats',
		};

		for (const vp of destinatarios) {
			await notificacionesService.crear({
				valorPersonal: vp,
				tipo: 'WHATSAPP_MENSAJE',
				descripcion,
				entidadTipo: 'BOT_CONVERSACION',
				entidadId: idConversacion,
				datos,
			});
		}
	} catch (e) {
		console.warn('[notif whatsapp] No crítico —', e.message);
	}
}

/**
 * Marca como leídas las notificaciones WhatsApp de una conversación para un usuario.
 */
async function marcarLeidasConversacion(idConversacion, valorPersonal) {
	if (!idConversacion || !valorPersonal) return;
	try {
		const { resolveImNotificacionesColumns, sqlEscapeIdent } = require('./notificacionesColumns');
		const cols = await resolveImNotificacionesColumns();
		if (!cols.usable) return;

		const vp = sqlEscapeIdent(cols.valorPersonal);
		const leida = sqlEscapeIdent(cols.leida);
		const tipo = sqlEscapeIdent(cols.tipoNotificacion);
		const entT = sqlEscapeIdent(cols.entidadTipo);
		const entI = sqlEscapeIdent(cols.entidadId);

		await executeQuery(
			`
			UPDATE dbo.imNotificaciones
			SET ${leida} = 1
			WHERE ${vp} = @param0
			  AND ${leida} = 0
			  AND (${tipo} = 'WHATSAPP_MENSAJE' OR ${entT} = 'BOT_CONVERSACION')
			  AND CAST(${entI} AS VARCHAR(120)) = @param1
			`,
			[
				{ value: Number(valorPersonal) },
				{ value: String(idConversacion) },
			],
		);
	} catch (e) {
		console.warn('[notif whatsapp] marcar leídas:', e.message);
	}
}

module.exports = {
	notificarMensajeWhatsAppEntrante,
	marcarLeidasConversacion,
	obtenerDestinatariosWhatsApp,
};
