/**
 * Mapeo de errores de agenda/pacientes a códigos legibles para el chatbot.
 */
const ERROR_MAP = [
	{ match: /ocupado/i, code: 'SLOT_OCUPADO', mensajeBot: 'Ese horario ya no está disponible. ¿Querés ver otros horarios?' },
	{ match: /bloqueada/i, code: 'FECHA_BLOQUEADA', mensajeBot: 'El profesional no atiende en esa fecha.' },
	{ match: /slot válido/i, code: 'SLOT_INVALIDO', mensajeBot: 'El horario indicado no es válido para ese profesional.' },
	{ match: /fechas anteriores/i, code: 'FECHA_PASADA', mensajeBot: 'No se pueden reservar turnos en fechas pasadas.' },
	{ match: /Paciente inexistente/i, code: 'PACIENTE_NO_ENCONTRADO', mensajeBot: 'No encontramos la ficha del paciente.' },
	{ match: /ya está cancelado/i, code: 'TURNO_YA_CANCELADO', mensajeBot: 'Ese turno ya estaba cancelado.' },
	{ match: /ya atendido/i, code: 'TURNO_ATENDIDO', mensajeBot: 'No se puede modificar un turno ya atendido.' },
	{ match: /RENAPER|not_found/i, code: 'RENAPER_NO_ENCONTRADO', mensajeBot: 'No encontramos datos en RENAPER con ese DNI. Verificá el número.' },
	{ match: /matricula del profesional es requerida/i, code: 'MATRICULA_REQUERIDA', mensajeBot: 'Primero elegí un profesional de la especialidad.' },
	{ match: /Profesional no encontrado|PROFESIONAL_INEXISTENTE/i, code: 'PROFESIONAL_INEXISTENTE', mensajeBot: 'Ese profesional no está habilitado en la agenda. Elegí otro médico de la lista.' },
	{ match: /no pertenece a la especialidad/i, code: 'ESPECIALIDAD_NO_COINCIDE', mensajeBot: 'El profesional no corresponde a la especialidad elegida.' },
];

function mapBotError(err, fallbackCode = 'ERROR_INTERNO') {
	const msg = String(err?.message || err || '');
	const statusCode = err?.statusCode || 500;
	const found = ERROR_MAP.find((e) => e.match.test(msg));
	if (found) {
		return { code: found.code, mensajeBot: found.mensajeBot, statusCode, mensaje: msg };
	}
	return {
		code: fallbackCode,
		mensajeBot: 'Ocurrió un error. Por favor intentá de nuevo o contactá a la institución.',
		statusCode,
		mensaje: msg || 'Error interno',
	};
}

module.exports = { mapBotError, ERROR_MAP };
