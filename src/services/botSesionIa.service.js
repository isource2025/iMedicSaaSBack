/**
 * Sesión de contexto para IA: historial acotado a la gestión en curso y saludo diario (AR).
 * El historial completo permanece en BD; solo se filtra lo enviado a los modelos.
 */
function _botConversacion() {
	return require('./botConversacion.service');
}

const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires';

function _partesFechaHoraAr(date = new Date()) {
	const d = date instanceof Date ? date : new Date(date);
	const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_ARGENTINA }).format(d);
	const hora = Number(
		new Intl.DateTimeFormat('en-US', {
			timeZone: TZ_ARGENTINA,
			hour: 'numeric',
			hour12: false,
		}).format(d),
	);
	return { fecha, hora };
}

function fechaArgentinaHoy(date = new Date()) {
	return _partesFechaHoraAr(date).fecha;
}

function franjaHorariaArgentina(date = new Date()) {
	const { hora } = _partesFechaHoraAr(date);
	if (hora >= 6 && hora < 12) return 'manana';
	if (hora >= 12 && hora < 20) return 'tarde';
	if (hora >= 20 || hora < 1) return 'noche';
	return 'madrugada';
}

/** Meta que sobrevive al cierre de una gestión (historial IA + saludo diario). */
function extraerMetaPersistente(contextoBot) {
	const ctx = contextoBot || {};
	return {
		...(ctx.historialIa ? { historialIa: ctx.historialIa } : {}),
		...(ctx.saludoDia ? { saludoDia: ctx.saludoDia } : {}),
	};
}

function obtenerMarcadorHistorialIa(conv) {
	const desdeId = conv?.contextoBot?.historialIa?.desdeIdMensaje;
	return Number.isFinite(Number(desdeId)) && Number(desdeId) > 0 ? Number(desdeId) : null;
}

/**
 * Contexto de saludo para la IA (sin texto fijo al paciente).
 */
function contextoSaludo(conv) {
	const hoy = fechaArgentinaHoy();
	const ultimoSaludo = conv?.contextoBot?.saludoDia || null;
	const debeSaludar = ultimoSaludo !== hoy;
	const franja = franjaHorariaArgentina();

	return {
		debeSaludar,
		franjaHoraria: franja,
		fechaArgentina: hoy,
		zonaHoraria: TZ_ARGENTINA,
		pautaInstruccion: debeSaludar
			? `Primera interacción del día calendario (${hoy}, hora Argentina / GMT-3). Incluí un saludo breve y natural según la franja "${franja}". Redactalo vos; no repitas siempre la misma fórmula ni uses "soy un asistente".`
			: null,
	};
}

async function marcarSaludoEnviado(idConversacion, conv) {
	const botConversacion = _botConversacion();
	const hoy = fechaArgentinaHoy();
	const convAct = conv || (await botConversacion.obtenerConversacion(idConversacion));
	const ctx = { ...(convAct?.contextoBot || {}), saludoDia: hoy };
	await botConversacion.guardarContextoBot(idConversacion, ctx);
}

/**
 * Cierra la ventana de historial para IA (tras confirmar turno o cancelar gestión).
 * Los mensajes siguen en BD; el próximo mensaje arranca contexto limpio.
 */
async function resetearSesionIa(idConversacion) {
	const botConversacion = _botConversacion();
	const msgs = await botConversacion.listarMensajes(idConversacion, { limit: 200 });
	const lastId = msgs.length ? Number(msgs[msgs.length - 1].idMensaje) : 0;
	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const meta = extraerMetaPersistente(conv?.contextoBot);
	meta.historialIa = {
		desdeIdMensaje: lastId,
		resetAt: new Date().toISOString(),
	};
	await botConversacion.guardarContextoBot(idConversacion, meta, { reemplazar: true });
}

/**
 * Mensajes visibles para modelos (solo gestión en curso).
 */
async function listarMensajesParaIa(idConversacion, { limit = 24 } = {}) {
	const botConversacion = _botConversacion();
	const lim = Math.min(50, Math.max(1, Number(limit) || 24));
	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const desdeId = obtenerMarcadorHistorialIa(conv);
	const msgs = await botConversacion.listarMensajes(idConversacion, {
		limit: 200,
		desdeId,
	});
	return msgs.slice(-lim);
}

function mensajesParaOpenAi(mensajes) {
	return (mensajes || [])
		.filter((m) => m.origen === 'PACIENTE' || m.origen === 'BOT')
		.map((m) => ({
			role: m.origen === 'BOT' ? 'assistant' : 'user',
			content: String(m.contenido || '').trim(),
		}))
		.filter((m) => m.content);
}

module.exports = {
	TZ_ARGENTINA,
	fechaArgentinaHoy,
	franjaHorariaArgentina,
	contextoSaludo,
	marcarSaludoEnviado,
	resetearSesionIa,
	listarMensajesParaIa,
	mensajesParaOpenAi,
	extraerMetaPersistente,
	obtenerMarcadorHistorialIa,
};
