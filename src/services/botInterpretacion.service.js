/**
 * Cerebro interpretativo unificado del bot de turnos.
 * Una llamada GPT por mensaje → intención + flags + hint de redacción.
 * El wizard ejecuta acciones; botHumanizer redacta la salida.
 */
const botOpenai = require('./botOpenai.service');
const botConversacion = require('./botConversacion.service');
const botAgenda = require('./botAgenda.service');

const FLAGS_DEFAULT = Object.freeze({
	salir_flujo: false,
	frustracion: false,
	necesita_aclaracion: false,
	es_saludo: false,
	confianza: 0.5,
	tono_sugerido: 'cercano',
	menciona_tercero: false,
});

function gptHabilitado() {
	return botOpenai.isConfigured();
}

function humanizarHabilitado() {
	return gptHabilitado();
}

function _normalizarTexto(texto) {
	return String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function _interpretarSalidaFlujo(texto) {
	const t = _normalizarTexto(texto);
	if (!t) return false;
	if (
		/^(cancela|cancelar|cancelalo|cancel|salir|chau|deja|dejalo|olvida|olvidate|basta|alcanza|no gracias)$/.test(
			t,
		)
	) {
		return true;
	}
	if (
		/\b(no quiero|no necesito|no busco|no voy a sacar|no saco|no reservo)\b/.test(t) &&
		/\b(ningun|turno|turnos|cita|reserva)\b/.test(t)
	) {
		return true;
	}
	if (/\b(cancelar|cancela|anular|abandonar)\b/.test(t) && /\b(turno|todo|flujo|gestion)\b/.test(t)) {
		return true;
	}
	if (/\b(no quiero|deja)\b/.test(t) && /\b(nada|seguir|continuar)\b/.test(t)) return true;
	return false;
}

function _esSaludoSimple(texto) {
	const t = _normalizarTexto(texto);
	return /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)[!.?\s]*$/.test(t);
}

function _extraerDni(texto) {
	const m = String(texto || '').match(/\b(\d{7,8})\b/);
	return m ? m[1] : null;
}

function _interpretarConfirmacion(texto) {
	const t = _normalizarTexto(texto);
	if (/^(si|s|yes|ok|dale|confirmo|correcto|exacto|soy yo|afirmativo|su)$/.test(t)) return true;
	if (/^dale\b/.test(t)) return true;
	if (/^(no|n|nop|incorrecto|otra persona|negativo)$/.test(t)) return false;
	if (/\bno\s+tenes?\b/.test(t) || /\bno\s+hay\b/.test(t)) return null;
	if (/\b(si|confirmo|correcto)\b/.test(t)) return true;
	if (/\b(incorrecto|otra persona)\b/.test(t)) return false;
	if (/\b(no confirmo|no quiero|no gracias|no me sirve)\b/.test(t)) return false;
	if (/^no\b/.test(t) && t.length <= 12) return false;
	return null;
}

function _interpretarRechazoTurno(texto) {
	const conf = _interpretarConfirmacion(texto);
	if (conf === true) return false;
	if (conf === false) return true;
	const t = _normalizarTexto(texto);
	if (!t) return null;
	if (
		/\b(no puedo|no me sirve|otro dia|otra fecha|otro horario|prefiero otro|buscar otro|siguiente turno)\b/.test(
			t,
		)
	) {
		return true;
	}
	return null;
}

function _parsearJson(raw) {
	const s = String(raw || '')
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function _clampConfianza(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0.5;
	return Math.min(1, Math.max(0, n));
}

function _normalizarFlags(raw = {}) {
	return {
		salir_flujo: Boolean(raw.salir_flujo),
		frustracion: Boolean(raw.frustracion),
		necesita_aclaracion: Boolean(raw.necesita_aclaracion),
		es_saludo: Boolean(raw.es_saludo),
		confianza: _clampConfianza(raw.confianza),
		tono_sugerido: ['cercano', 'formal', 'empatico', 'breve'].includes(raw.tono_sugerido)
			? raw.tono_sugerido
			: 'cercano',
		menciona_tercero: Boolean(raw.menciona_tercero),
	};
}

function _contextoTurno(conv) {
	const ctx = conv?.contextoBot || {};
	if (ctx.tipo !== 'turno_sugerido') return '';
	return [
		`Turno ofrecido: ${ctx.medico || '?'} — ${ctx.diaSemana || ''} ${ctx.fechaLegible || ctx.fecha || ''} ${ctx.hora || ''}`,
		`Especialidad: ${ctx.especialidadNombre || '?'}`,
	].join('\n');
}

function _promptBase(conv, paso, especialidades) {
	const lista = (especialidades || []).map((e) => e.nombre).join(', ');
	const ctx = [];
	if (conv?.nombreContacto) ctx.push(`Contacto WhatsApp: ${conv.nombreContacto}`);
	if (conv?.dniPaciente) ctx.push(`DNI en curso: ${conv.dniPaciente}`);
	if (conv?.idPaciente) ctx.push('Paciente ya identificado en sesión.');
	if (conv?.contextoBot?.especialidadPendiente?.nombre) {
		ctx.push(`Especialidad pendiente: ${conv.contextoBot.especialidadPendiente.nombre}`);
	}
	const turno = _contextoTurno(conv);
	if (turno) ctx.push(turno);
	const sesion = conv?.contextoBot?.sesionInterpretacion;
	if (sesion?.frustracion >= 2) {
		ctx.push(`El paciente mostró frustración reciente (nivel ${sesion.frustracion}).`);
	}

	return `Asistente de turnos médicos por WhatsApp (español rioplatense).
Paso actual del wizard: ${paso || 'inicio'}.
${ctx.length ? `Contexto:\n${ctx.join('\n')}\n` : ''}
Especialidades válidas (nombre EXACTO si aplica): ${lista || '(sin catálogo)'}

Respondé ÚNICAMENTE un JSON en una línea con esta forma:
{"intencion":"...","parametros":{...},"flags":{"salir_flujo":false,"frustracion":false,"necesita_aclaracion":false,"es_saludo":false,"confianza":0.9,"tono_sugerido":"cercano","menciona_tercero":false},"mensaje_sugerido":null}

Flags:
- salir_flujo: true si quiere cancelar/abandonar la gestión ("cancelar", "no quiero ningún turno", "dejá")
- frustracion: true si expresa molestia, confusión o repite quejas
- necesita_aclaracion: true si el mensaje es ambiguo y conviene una pregunta corta
- es_saludo: true si es solo saludo sin pedido claro
- confianza: 0.0 a 1.0 sobre tu clasificación
- tono_sugerido: cercano | formal | empatico | breve
- menciona_tercero: true si el turno es para otra persona (hijo, mamá, etc.)

mensaje_sugerido: frase corta opcional que capture el tono emocional (NO incluyas fechas ni médicos inventados).`;
}

function _intencionesPorPaso(paso, conv) {
	if (paso === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') {
		return `Intenciones: confirmar_turno | buscar_turno | rechazar_turno | cancelar_flujo | cambiar_especialidad | conversacion
- confirmar_turno: acepta el turno ofrecido ("dale", "perfecto", "sí")
- buscar_turno: pide otro día/horario con preferencia
- rechazar_turno: no quiere ESE turno pero sigue buscando
- cancelar_flujo: no quiere ningún turno / abandonar
- cambiar_especialidad: quiere otra área médica`;
	}
	if (paso === 'CONFIRMAR_IDENTIDAD') {
		return `Intenciones: confirmar_identidad | rechazar_identidad | elegir_especialidad | cancelar_flujo | conversacion`;
	}
	if (paso === 'ELEGIR_ESPECIALIDAD') {
		return `Intenciones: elegir_especialidad | listar_especialidades | listar_profesionales | cancelar_flujo | conversacion | solicitar_turno`;
	}
	if (paso === 'TURNO_COMPLETADO') {
		return `Intenciones: agradecimiento | solicitar_turno | elegir_especialidad | listar_especialidades | conversacion`;
	}
	return `Intenciones: solicitar_turno | elegir_especialidad | listar_especialidades | listar_profesionales | agradecimiento | cancelar_flujo | conversacion | proporcionar_dni`;
}

function _construirPrompt(conv, paso, especialidades) {
	return `${_promptBase(conv, paso, especialidades)}

${_intencionesPorPaso(paso, conv)}

parametros puede incluir: especialidad, preferirDiasSemana[], excluirDiasSemana[], preferirFranja, preferirFechas[], resumen.

Reglas:
- Interpretá significado, no palabras exactas.
- "cancela", "no quiero turno" → cancelar_flujo + salir_flujo true
- Saludo solo ("hola", "buenas") → es_saludo true, conversacion
- Tras comprobante de turno, "gracias" → agradecimiento (no solicitar_turno)
- No inventes especialidades fuera de la lista.`;
}

async function _historialCorto(idConversacion) {
	if (!idConversacion) return [];
	try {
		const msgs = await botConversacion.listarMensajes(idConversacion, { limit: 10 });
		return (msgs || [])
			.slice(-8)
			.filter((m) => m.origen === 'PACIENTE' || m.origen === 'BOT')
			.map((m) => ({
				role: m.origen === 'BOT' ? 'assistant' : 'user',
				content: String(m.contenido || '').trim(),
			}))
			.filter((m) => m.content);
	} catch {
		return [];
	}
}

/** Reglas locales cuando GPT no está o falla. */
function _interpretacionPorReglas(texto, conv, paso) {
	const t = String(texto || '').trim();
	if (!t) return null;

	const flags = { ...FLAGS_DEFAULT };
	let intencion = 'conversacion';
	const parametros = { resumen: '' };

	if (_interpretarSalidaFlujo(t)) {
		return {
			intencion: 'cancelar_flujo',
			parametros,
			flags: { ...flags, salir_flujo: true, confianza: 0.95 },
			mensaje_sugerido: null,
			paso,
			fuente: 'reglas',
		};
	}

	if (_esSaludoSimple(t)) {
		return {
			intencion: 'conversacion',
			parametros,
			flags: { ...flags, es_saludo: true, confianza: 0.9 },
			mensaje_sugerido: null,
			paso,
			fuente: 'reglas',
		};
	}

	const conf = _interpretarConfirmacion(t);
	if (paso === 'CONFIRMAR_IDENTIDAD') {
		if (conf === true) intencion = 'confirmar_identidad';
		else if (conf === false) intencion = 'rechazar_identidad';
		else return null;
		return {
			intencion,
			parametros,
			flags: { ...flags, confianza: 0.85 },
			mensaje_sugerido: null,
			paso,
			fuente: 'reglas',
		};
	}

	if (paso === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') {
		if (conf === true) intencion = 'confirmar_turno';
		else if (conf === false) intencion = 'rechazar_turno';
		else if (_interpretarRechazoTurno(t, conv.contextoBot)) {
			intencion = 'buscar_turno';
		} else return null;
		return {
			intencion,
			parametros,
			flags: { ...flags, confianza: 0.8 },
			mensaje_sugerido: null,
			paso,
			fuente: 'reglas',
		};
	}

	if (paso === 'ELEGIR_PROFESIONAL') {
		if (conf === false || _interpretarRechazoTurno(t)) {
			return {
				intencion: 'cambiar_especialidad',
				parametros,
				flags: { ...flags, confianza: 0.85 },
				mensaje_sugerido: null,
				paso,
				fuente: 'reglas',
			};
		}
	}

	if (_extraerDni(t)) {
		return {
			intencion: 'proporcionar_dni',
			parametros,
			flags: { ...flags, confianza: 0.95 },
			mensaje_sugerido: null,
			paso,
			fuente: 'reglas',
		};
	}

	return null;
}

function _normalizarInterpretacionGpt(j, paso) {
	if (!j?.intencion) return null;
	return {
		intencion: String(j.intencion).trim().toLowerCase(),
		parametros: j.parametros && typeof j.parametros === 'object' ? j.parametros : {},
		flags: _normalizarFlags({ ...FLAGS_DEFAULT, ...(j.flags || {}) }),
		mensaje_sugerido: j.mensaje_sugerido ? String(j.mensaje_sugerido).trim() : null,
		paso,
		fuente: 'gpt',
	};
}

/**
 * Interpretación unificada por mensaje (intención + flags + hint).
 * @returns {Promise<object|null>}
 */
async function interpretarMensaje({ texto, conv, idConversacion, pasoBot }) {
	const paso = pasoBot || conv?.pasoBot || 'inicio';
	const ultimo = String(texto || '').trim();
	if (!ultimo) return null;

	if (!gptHabilitado()) {
		return _interpretacionPorReglas(ultimo, conv, paso);
	}

	const especialidades = await botAgenda.listarEspecialidadesBot().catch(() => []);
	const system = _construirPrompt(conv, paso, especialidades);
	const historial = await _historialCorto(idConversacion);
	const messages = [...historial];
	if (!messages.length || messages[messages.length - 1].content !== ultimo) {
		messages.push({ role: 'user', content: ultimo });
	}

	let raw;
	try {
		raw = await botOpenai.chat({ system, messages });
	} catch (err) {
		console.warn('[botInterpretacion] GPT:', err.message);
		return _interpretacionPorReglas(ultimo, conv, paso);
	}

	const normalizada = _normalizarInterpretacionGpt(_parsearJson(raw), paso);
	if (!normalizada) return _interpretacionPorReglas(ultimo, conv, paso);

	// Refuerzo: reglas de alta confianza prevalecen sobre GPT
	const reglas = _interpretacionPorReglas(ultimo, conv, paso);
	if (reglas?.flags?.salir_flujo) return reglas;
	if (reglas?.intencion === 'confirmar_turno' || reglas?.intencion === 'confirmar_identidad') {
		if (reglas.flags.confianza >= 0.85) return reglas;
	}

	return normalizada;
}

/** Persiste frustración y última intención en contextoBot. */
async function registrarSesion(idConversacion, interpretacion, conv) {
	if (!interpretacion || !idConversacion) return;
	const ctx = { ...(conv?.contextoBot || {}) };
	const prev = ctx.sesionInterpretacion || { frustracion: 0 };
	let frustracion = Number(prev.frustracion) || 0;

	const int = interpretacion.intencion;
	if (interpretacion.flags?.frustracion || int === 'rechazar_turno') {
		frustracion += 1;
	} else if (['confirmar_turno', 'agradecimiento', 'cancelar_flujo'].includes(int)) {
		frustracion = Math.max(0, frustracion - 1);
	}

	ctx.sesionInterpretacion = {
		frustracion,
		ultimaIntencion: int,
		ultimoTono: interpretacion.flags?.tono_sugerido || 'cercano',
	};
	await botConversacion.guardarContextoBot(idConversacion, ctx);
}

function nivelFrustracion(conv) {
	return Number(conv?.contextoBot?.sesionInterpretacion?.frustracion) || 0;
}

/** Compat: solo intención + parámetros (API anterior). */
async function interpretarIntencion(opts) {
	const full = await interpretarMensaje(opts);
	if (!full) return null;
	return {
		intencion: full.intencion,
		parametros: full.parametros,
		paso: full.paso,
		flags: full.flags,
		mensaje_sugerido: full.mensaje_sugerido,
	};
}

function debeSalirFlujo(interpretacion, texto) {
	if (interpretacion?.flags?.salir_flujo) return true;
	if (interpretacion?.intencion === 'cancelar_flujo') return true;
	return _interpretarSalidaFlujo(texto);
}

module.exports = {
	gptHabilitado,
	humanizarHabilitado,
	FLAGS_DEFAULT,
	interpretarMensaje,
	interpretarIntencion,
	registrarSesion,
	nivelFrustracion,
	debeSalirFlujo,
};
