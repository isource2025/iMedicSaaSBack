/**
 * Catálogo de herramientas del bot: la IA elige cuáles invocar;
 * acá se ejecuta la lógica real (agenda, pacientes, sesión).
 */
const botAgenda = require('./botAgenda.service');
const botConversacion = require('./botConversacion.service');

const DEFINICIONES = [
	{
		nombre: 'estado_sesion',
		descripcion: 'Devuelve el estado actual de la conversación (paso, DNI, médico/especialidad pendientes, turno ofrecido).',
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
			'Busca médicos en la agenda por apellido o nombre. Cada resultado incluye su especialidad. Opcionalmente filtrá por especialidad.',
		parametros: {
			texto: 'string — apellido o nombre (ej. "De Biasi", "biasi")',
			especialidad: 'string opcional — nombre de especialidad para acotar',
		},
	},
	{
		nombre: 'listar_profesionales_especialidad',
		descripcion: 'Lista todos los profesionales con agenda en una especialidad (usar solo si el paciente pide ver la lista).',
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

async function ejecutar(nombre, argumentos = {}, ctx = {}) {
	const args = argumentos && typeof argumentos === 'object' ? argumentos : {};
	const conv = ctx.conv;

	switch (nombre) {
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
					especialidad_pendiente: bot.especialidadPendiente || null,
					profesional_pendiente: bot.profesionalPendiente || null,
					turno_en_oferta: turno,
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
			let espValor = null;
			if (args.especialidad) {
				const esp = await _resolverEspValor(args.especialidad);
				espValor = esp?.valor ?? null;
			}
			const analisis = await botAgenda.analizarPedidoTurnoConProfesional(texto, {
				especialidadValor: espValor,
				especialidadCtx: conv?.contextoBot?.especialidadPendiente,
			});
			return { ok: true, datos: analisis };
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

/** Persiste en sesión lo que las herramientas resolvieron (datos operativos). */
async function aplicarContextoDesdeResultados(idConversacion, conv, resultados) {
	if (!idConversacion || !Array.isArray(resultados)) return conv;

	let ctx = { ...(conv?.contextoBot || {}) };

	for (const r of resultados) {
		if (!r.ok || !r.datos) continue;
		const d = r.datos;

		if (r.nombre === 'buscar_profesional' && d.tipo === 'unico') {
			ctx.especialidadPendiente = d.especialidad;
			ctx.profesionalPendiente = d.profesional;
			ctx.candidatosProfesionales = null;
		}
		if (r.nombre === 'buscar_profesional' && d.tipo === 'multiples') {
			ctx.candidatosProfesionales = d.matches.slice(0, 8);
		}
		if (r.nombre === 'resolver_especialidad' && d.encontrada) {
			ctx.especialidadPendiente = d.especialidad;
		}
	}

	await botConversacion.guardarContextoBot(idConversacion, ctx);
	return (await botConversacion.obtenerConversacion(idConversacion)) || conv;
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
};
