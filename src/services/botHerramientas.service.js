/**
 * Catálogo de herramientas del bot: la IA elige cuáles invocar;
 * acá se ejecuta la lógica real (agenda, pacientes, sesión).
 */
const botAgenda = require('./botAgenda.service');
const botConversacion = require('./botConversacion.service');
const botGestionTurno = require('./botGestionTurno.service');
const botOpenai = require('./botOpenai.service');
const botSesionIa = require('./botSesionIa.service');
const diag = require('../utils/diagLog');

const DEFINICIONES = [
	{
		nombre: 'estado_gestion',
		descripcion:
			'Devuelve la gestión de turno activa (identidad, profesional, especialidad, preferencia horaria, turno ofrecido). SIEMPRE consultar primero.',
		parametros: {},
	},
	{
		nombre: 'estado_sesion',
		descripcion: 'Estado de conversación (paso, DNI, pendientes legacy).',
		parametros: {},
	},
	{
		nombre: 'listar_especialidades',
		descripcion: 'Lista especialidades con agenda disponible.',
		parametros: {},
	},
	{
		nombre: 'resolver_especialidad',
		descripcion: 'Interpreta texto del paciente y devuelve una especialidad del catálogo si existe.',
		parametros: { texto: 'string — fragmento que menciona la especialidad' },
	},
	{
		nombre: 'buscar_profesional',
		descripcion:
			'Busca médicos en la agenda por apellido o nombre (tolera errores de transcripción). Cada resultado incluye su especialidad.',
		parametros: {
			texto: 'string — apellido o nombre (ej. "De Biasi", "biasi", "viasi")',
			especialidad: 'string opcional — nombre de especialidad para acotar',
		},
	},
	{
		nombre: 'interpretar_preferencia_horario',
		descripcion:
			'Interpreta preferencias temporales del paciente: mes (agosto), semana que viene, día concreto, franja tarde/mañana.',
		parametros: { texto: 'string — mensaje del paciente' },
	},
	{
		nombre: 'buscar_turno_disponible',
		descripcion:
			'Busca el turno libre más cercano según gestión activa (profesional, especialidad, preferencia horaria).',
		parametros: {
			especialidadValor: 'number opcional',
			matricula: 'number opcional',
		},
	},
	{
		nombre: 'listar_profesionales_especialidad',
		descripcion: 'Lista profesionales con agenda en una especialidad (solo si el paciente pide ver la lista).',
		parametros: { especialidad: 'string — nombre de la especialidad' },
	},
];

function catalogoParaPrompt() {
	return DEFINICIONES.map((h) => {
		const params = Object.entries(h.parametros)
			.map(([k, v]) => `    - ${k}: ${v}`)
			.join('\n');
		return `- ${h.nombre}: ${h.descripcion}${params ? `\n  Parámetros:\n${params}` : ''}`;
	}).join('\n\n');
}

function listarNombres() {
	return DEFINICIONES.map((h) => h.nombre);
}

async function _resolverEspValor(textoEsp) {
	if (!textoEsp) return null;
	const r = await botAgenda.resolverEspecialidadDesdeTexto(String(textoEsp));
	return r ? { valor: r.valor, nombre: r.nombre } : null;
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

async function interpretarPreferenciaHorarioGpt(texto, sugerenciaActual = null) {
	const local = botAgenda.interpretarAjusteTurno(texto, sugerenciaActual);
	if (
		local.preferir?.fechaDesde ||
		local.preferir?.fechas?.length ||
		local.preferir?.franja ||
		local.resumen
	) {
		return {
			resumen: local.resumen,
			fechaDesde: local.preferir.fechaDesde || local.preferir.fechas?.[0] || null,
			fechaHasta: local.preferir.fechaHasta || null,
			franja: local.preferir.franja || null,
			diasSemana: local.preferir.diasSemana || [],
			flexible: true,
			fuente: 'reglas',
		};
	}

	if (!botOpenai.isConfigured()) return null;

	const hoy = botSesionIa.fechaArgentinaHoy();
	const ctxTurno = sugerenciaActual
		? `Turno actual: ${sugerenciaActual.medico || ''} ${sugerenciaActual.fecha || ''} ${sugerenciaActual.hora || ''}`
		: '';

	let raw;
	try {
		raw = await botOpenai.chat({
			system: `Interpretá preferencia de fecha/horario del paciente (Argentina, hoy=${hoy}).
${ctxTurno}
Respondé ÚNICAMENTE JSON:
{"resumen":"texto corto","fechaDesde":"YYYY-MM-DD"|null,"fechaHasta":"YYYY-MM-DD"|null,"franja":"tarde"|"manana"|"noche"|null,"flexible":true}

Ejemplos:
- "para agosto" → fechaDesde primer día de agosto del año correspondiente, fechaHasta último día de agosto
- "semana que viene" → lunes a domingo de la semana calendario siguiente
- "el 15 de agosto" → fechaDesde y fechaHasta = ese día`,
			messages: [{ role: 'user', content: String(texto || '').trim() }],
		});
	} catch (err) {
		diag.warn('herramientas', 'GPT preferencia horario falló', { error: err.message });
		return null;
	}

	const j = _parsearJson(raw);
	if (!j?.resumen && !j?.fechaDesde) return null;
	return {
		resumen: j.resumen || null,
		fechaDesde: j.fechaDesde ? String(j.fechaDesde).slice(0, 10) : null,
		fechaHasta: j.fechaHasta ? String(j.fechaHasta).slice(0, 10) : null,
		franja: j.franja || null,
		diasSemana: [],
		flexible: j.flexible !== false,
		fuente: 'gpt',
	};
}

async function ejecutar(nombre, argumentos = {}, ctx = {}) {
	const args = argumentos && typeof argumentos === 'object' ? argumentos : {};
	const conv = ctx.conv;
	const gestion = botGestionTurno.obtenerGestionActiva(conv) || botGestionTurno.ensureGestion(conv);

	switch (nombre) {
		case 'estado_gestion': {
			return {
				ok: true,
				datos: {
					gestion,
					resumen: botGestionTurno.resumenParaPrompt(gestion),
					tiene_paciente: Boolean(conv?.idPaciente),
					paso: conv?.pasoBot || 'inicio',
				},
			};
		}

		case 'estado_sesion': {
			const bot = conv?.contextoBot || {};
			const turno =
				bot.tipo === 'turno_sugerido'
					? {
							medico: bot.medico,
							especialidad: bot.especialidadNombre,
							fecha: bot.fechaLegible || bot.fecha,
							hora: bot.hora,
							diaSemana: bot.diaSemana,
						}
					: null;
			return {
				ok: true,
				datos: {
					paso: conv?.pasoBot || 'inicio',
					tiene_paciente: Boolean(conv?.idPaciente),
					dni_en_curso: conv?.dniPaciente || null,
					nombre_contacto: conv?.nombreContacto || null,
					gestion_turno: botGestionTurno.resumenParaPrompt(gestion),
					especialidad_pendiente: bot.especialidadPendiente || gestion.especialidad || null,
					profesional_pendiente: bot.profesionalPendiente || gestion.profesional || null,
					preferencia_horario: gestion.preferenciaHorario || null,
					turno_en_oferta: turno || gestion.turnoOfrecido || null,
					candidatos_profesionales: bot.candidatosProfesionales?.length || 0,
				},
			};
		}

		case 'listar_especialidades': {
			const lista = await botAgenda.listarEspecialidadesBot();
			return {
				ok: true,
				datos: {
					cantidad: lista.length,
					especialidades: lista.map((e) => e.nombre),
				},
			};
		}

		case 'resolver_especialidad': {
			if (gestion.especialidad?.confirmada && gestion.profesional?.confirmada) {
				return {
					ok: true,
					datos: {
						encontrada: true,
						especialidad: gestion.especialidad,
						ya_confirmada: true,
					},
				};
			}
			const esp = await botAgenda.resolverEspecialidadDesdeTexto(String(args.texto || ''));
			if (!esp) {
				return { ok: true, datos: { encontrada: false } };
			}
			return {
				ok: true,
				datos: { encontrada: true, especialidad: { valor: esp.valor, nombre: esp.nombre } },
			};
		}

		case 'buscar_profesional': {
			const texto = String(args.texto || '').trim();
			if (!texto) {
				return { ok: false, error: 'Falta texto de búsqueda' };
			}
			let espValor = gestion.especialidad?.valor ?? null;
			if (args.especialidad) {
				const esp = await _resolverEspValor(args.especialidad);
				espValor = esp?.valor ?? espValor;
			}
			const analisis = await botAgenda.analizarPedidoTurnoConProfesional(texto, {
				especialidadValor: espValor,
				especialidadCtx: conv?.contextoBot?.especialidadPendiente || gestion.especialidad,
			});
			return { ok: true, datos: analisis };
		}

		case 'interpretar_preferencia_horario': {
			const texto = String(args.texto || '').trim();
			const sugerencia =
				conv?.contextoBot?.tipo === 'turno_sugerido'
					? conv.contextoBot
					: gestion.turnoOfrecido;
			const pref = await interpretarPreferenciaHorarioGpt(texto, sugerencia);
			if (!pref) {
				return { ok: true, datos: { interpretada: false } };
			}
			return { ok: true, datos: { interpretada: true, ...pref } };
		}

		case 'buscar_turno_disponible': {
			const espValor =
				Number(args.especialidadValor) ||
				gestion.especialidad?.valor ||
				conv?.contextoBot?.especialidadPendiente?.valor;
			const matricula =
				Number(args.matricula) ||
				gestion.profesional?.matricula ||
				conv?.contextoBot?.profesionalPendiente?.matricula ||
				null;

			if (!espValor) {
				return { ok: false, error: 'Falta especialidad para buscar turno' };
			}

			const { excluir, preferir } = botGestionTurno.aPreferenciasBusqueda(gestion);
			const opciones = { excluir, preferir };
			if (matricula) opciones.matricula = matricula;

			diag.line('herramientas', 'buscar_turno_disponible', {
				espValor,
				matricula,
				preferir,
			});

			let turno = await botAgenda.sugerirPrimerTurnoDisponible(espValor, opciones);
			turno = turno ? await botAgenda.validarSugerenciaTurno(turno, espValor) : null;

			if (!turno && (preferir.fechaDesde || preferir.fechas?.length)) {
				turno = await botAgenda.sugerirPrimerTurnoDisponible(espValor, {
					matricula: matricula || undefined,
					excluir,
					preferir: { ...preferir, fechaDesde: null, fechaHasta: null, fechas: [] },
				});
				turno = turno ? await botAgenda.validarSugerenciaTurno(turno, espValor) : null;
			}

			return {
				ok: true,
				datos: {
					encontrado: Boolean(turno),
					turno: turno || null,
					preferencia: gestion.preferenciaHorario?.resumen || null,
				},
			};
		}

		case 'listar_profesionales_especialidad': {
			const esp = await _resolverEspValor(args.especialidad || args.texto);
			if (!esp) {
				return { ok: true, datos: { encontrada: false, mensaje: 'Especialidad no reconocida' } };
			}
			const { profesionales } = await botAgenda.listarProfesionalesBot(esp.valor);
			return {
				ok: true,
				datos: {
					especialidad: esp,
					profesionales: profesionales.map((p) => ({
						matricula: p.matricula,
						nombre: p.nombre,
					})),
				},
			};
		}

		default:
			return { ok: false, error: `Herramienta desconocida: ${nombre}` };
	}
}

async function aplicarContextoDesdeResultados(idConversacion, conv, resultados) {
	if (!idConversacion || !Array.isArray(resultados)) return conv;

	let gestion = botGestionTurno.ensureGestion(conv);
	gestion = botGestionTurno.mergeDesdeIdentidad(gestion, conv);
	gestion = botGestionTurno.mergeDesdeHerramientas(gestion, resultados);

	const ctx = botGestionTurno.sincronizarLegacy(conv?.contextoBot, gestion);

	for (const r of resultados) {
		if (!r.ok || !r.datos) continue;
		const d = r.datos;
		if (r.nombre === 'buscar_profesional' && d.tipo === 'multiples') {
			ctx.candidatosProfesionales = d.matches.slice(0, 8);
		}
	}

	await botConversacion.guardarContextoBot(idConversacion, ctx);
	const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	diag.line('herramientas', 'contexto aplicado', {
		gestion: botGestionTurno.resumenParaPrompt(gestion),
	});
	return convAct;
}

async function ejecutarLote(llamadas, ctx) {
	const out = [];
	for (const call of llamadas || []) {
		const nombre = String(call?.nombre || '').trim();
		if (!listarNombres().includes(nombre)) {
			out.push({ nombre, ok: false, error: 'herramienta_no_valida' });
			continue;
		}
		const datos = await ejecutar(nombre, call.argumentos || {}, ctx);
		out.push({ nombre, ...datos });
	}
	return out;
}

module.exports = {
	DEFINICIONES,
	catalogoParaPrompt,
	listarNombres,
	ejecutar,
	ejecutarLote,
	aplicarContextoDesdeResultados,
	interpretarPreferenciaHorarioGpt,
};
