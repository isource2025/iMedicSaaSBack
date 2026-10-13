/**
 * Agente de Internación. Tools compuestas: el servidor pega a la visita.
 * LISTO se prende cuando el CRUD de consola cierra sin errores.
 */
const { def } = require('./def');
const soporte = require('./soporte');
const clinica = require('../clinica');
const crud = require('../internacionCrud');
const hc = require('../historiaClinica');
const cargas = require('../cargasClinicas');
const ficha = require('../ficha');
const sesion = require('../sesion');

const ID = 'INTERNACION';
// ASISTENTE_INTERNACION_LISTO=0 lo apaga sin redeploy (vuelve a caer a Soporte).
const LISTO = process.env.ASISTENTE_INTERNACION_LISTO !== '0';

/**
 * ASISTENTE_INTERNACION_ESCRITURA: sin valor = lectura + altas del menú médico (tools con `alta`);
 * 1 = todo (egreso, traslados, editar/borrar); 0 = solo lectura.
 */
function modoEscritura() {
	const v = String(process.env.ASISTENTE_INTERNACION_ESCRITURA ?? '').trim().toLowerCase();
	if (v === '1' || v === 'todo') return 'todo';
	if (v === '0' || v === 'lectura') return 'lectura';
	return 'altas';
}

function escrituraHabilitada(h) {
	const modo = modoEscritura();
	return modo === 'todo' || (modo === 'altas' && Boolean(h.alta));
}

const SIN_VISITA = 'No sé de qué internado. Primero ubicalo con buscar_internado (nombre, DNI o visita).';

function fijarFoco(ctx, item) {
	const f = ficha.deInternacion(item);
	ctx.foco = f;
	if (ctx.conv) sesion.guardarFoco(ctx.conv, f);
	return f;
}

async function buscarInternado(args, ctx) {
	const out = await clinica.buscarInternacion(args, ctx);
	const activos = out.internaciones || [];
	const egresadas = out.egresadas || [];
	if (activos.length === 1 || (!activos.length && egresadas.length === 1)) {
		const f = fijarFoco(ctx, activos[0] || egresadas[0]);
		return { ...out, ficha: ficha.textoDe(f) };
	}
	if (activos.length > 1) {
		return { ...out, aviso: 'Hay varios internados que coinciden. Preguntá cuál (número de visita) antes de seguir.' };
	}
	return out;
}

/** Completa numeroVisita con el foco; sin visita no se llama a la API. */
function conVisita(fn) {
	return (args, ctx) => {
		const numeroVisita = clinica.numeroVisitaDe(args, ctx);
		if (!numeroVisita) return { error: SIN_VISITA };
		return fn({ ...args, numeroVisita }, ctx);
	};
}

/** Con termino manda el nombre (como en el egreso); sin termino, la visita en foco. */
async function resolverVisita(args, ctx) {
	const termino = String(args.termino || '').trim();
	if (!termino) {
		const nv = clinica.numeroVisitaDe(args, ctx);
		return nv ? { numeroVisita: nv } : { error: SIN_VISITA };
	}
	const bus = await clinica.buscarInternacion({ termino }, ctx);
	let lista = bus.internaciones || [];
	if (!lista.length) return { error: bus.aviso || `No hay un internado que coincida con «${termino}».` };
	const nv = parseInt(args.numeroVisita, 10);
	if (Number.isFinite(nv) && nv > 0) {
		lista = lista.filter((i) => Number(i.numeroVisita) === nv);
		if (!lista.length) return { error: `La visita ${nv} no es de «${termino}». Confirmá a qué paciente.` };
	}
	if (lista.length > 1) {
		return { pedir: 'cual', aviso: 'Hay varios internados que coinciden. Indicá cuál (número de visita).', internaciones: lista };
	}
	fijarFoco(ctx, lista[0]);
	return { numeroVisita: lista[0].numeroVisita };
}

/** Escritura sobre un internado activo: resuelve el paciente (el nombre manda) y deja el resultado en foco. */
function sobreInternado(fn) {
	return async (args, ctx) => {
		const v = await resolverVisita(args, ctx);
		if (v.error || v.pedir) return v;
		return conFocoDe(await fn({ ...args, numeroVisita: v.numeroVisita }, ctx), ctx);
	};
}

function conFocoDe(out, ctx) {
	if (out?.internacion && !out.error && !out.pedir) fijarFoco(ctx, out.internacion);
	return out;
}

const prepararEvolucion = sobreInternado(clinica.prepararEvolucion);

/** Editar/borrar evolución: con nombre se valida que el registro sea de ese paciente. */
function sobreEvolucion(fn) {
	return async (args, ctx) => {
		let numeroVisita = args.numeroVisita;
		if (String(args.termino || '').trim()) {
			const v = await resolverVisita(args, ctx);
			if (v.error || v.pedir) return v;
			numeroVisita = v.numeroVisita;
		}
		return conFocoDe(await fn({ ...args, numeroVisita }, ctx), ctx);
	};
}

async function prepararEgreso(args, ctx) {
	const termino = String(args.termino || '').trim();
	// Con un nombre explícito no se usa el foco: podría ser otro paciente.
	const numeroVisita = args.numeroVisita || (termino ? null : clinica.numeroVisitaDe(args, ctx));
	if (!numeroVisita && !termino) return { error: SIN_VISITA };
	const out = await clinica.prepararEgreso({ ...args, numeroVisita: numeroVisita || undefined }, ctx);
	if (out?.internacion && !out.error) fijarFoco(ctx, out.internacion);
	return out;
}

const P_VISITA = { type: 'integer', description: 'Número de visita. Si se omite, la del internado en foco.' };
const P_FECHA = { type: 'string', description: 'YYYY-MM-DD. Default hoy.' };
const P_HORA = { type: 'string', description: 'HH:MM. Default ahora.' };
const P_TERMINO = {
	type: 'string',
	description: 'Nombre, DNI o visita SOLO si el usuario lo escribió en este mensaje. No copies el paciente en foco: omitilo.',
};
const P_CAMA = { type: 'string', description: 'Cama destino tal como la dijo el usuario (ej. 105, UTI-3). Omitila si no la dijo.' };
const P_SECTOR = { type: 'string', description: 'Sector de la cama destino (código o nombre), si lo dijo' };

const HERRAMIENTAS = Object.freeze([
	def({
		name: 'buscar_internado',
		description:
			'Ubica un internado por nombre, DNI o visita y devuelve la ficha COMPLETA (sector, cama, diagnóstico). Primer paso ante “dónde está”. Deja al paciente en foco para las siguientes tools.',
		permiso: ['INTERNACION.CAMAS.VER', 'ADMISION.PACIENTES.VER', 'ADMISION.BUSQUEDA.VER'],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: { type: 'string', description: 'Nombre, DNI o número de visita' },
				incluirEgresadas: { type: 'boolean', description: 'true para traer también visitas ya egresadas' },
			},
			required: ['termino'],
		},
		run: buscarInternado,
	}),
	def({
		name: 'ver_estudios',
		description:
			'Estudios pedidos para la visita (práctica, servicio, si está hecho, resultado). filtro=hechos son los cumplidos, NO la bandeja de pendientes del servicio.',
		permiso: ['INTERNACION.ESTUDIOS.VER'],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				numeroVisita: P_VISITA,
				filtro: { type: 'string', enum: ['hechos', 'pendientes', 'todos'], description: 'Default todos. “ya hechos” = hechos.' },
			},
		},
		run: conVisita(clinica.verEstudios),
	}),
	def({
		name: 'ver_evoluciones',
		description: 'Evoluciones médicas de la visita hasta la fecha, con profesional y texto.',
		permiso: ['INTERNACION.EVOLUCIONES.VER'],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				numeroVisita: P_VISITA,
				fecha: P_FECHA,
				dias: { type: 'integer', description: 'Días hacia atrás desde la fecha. Default 7.' },
				todas: { type: 'boolean', description: 'true = toda la internación' },
			},
		},
		run: conVisita((args, ctx) => clinica.verEvoluciones({ ...args, dias: args.todas ? 'all' : args.dias }, ctx)),
	}),
	def({
		name: 'ver_indicaciones',
		description: 'Indicaciones médicas de la visita para una fecha (default hoy).',
		permiso: ['INTERNACION.INDICACIONES.VER'],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				numeroVisita: P_VISITA,
				fecha: P_FECHA,
				dias: { type: 'integer', description: 'Días hacia atrás desde la fecha. Default solo ese día.' },
				incluirSuspendidas: { type: 'boolean' },
			},
		},
		run: conVisita(clinica.verIndicaciones),
	}),
	def({
		name: 'ver_historia_clinica',
		description:
			'Lee secciones de la HC de la visita que no tienen tool propia: hc_ingreso, laboratorios, signos_vitales, medicacion (suministrada), interconsultas, evolucion_enfermeria, balance_hidrico, dieta, epicrisis, protocolos, procedimientos, insumos, adjuntos (solo listado). Hasta 6 secciones por llamada. Para un análisis o resumen clínico pedí las que hagan falta.',
		permiso: [...new Set(Object.values(hc.SECCIONES).map((s) => s.permiso))],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				numeroVisita: P_VISITA,
				secciones: {
					type: 'array',
					items: { type: 'string', enum: hc.NOMBRES },
					description:
						'TODAS las secciones que hagan falta, juntas en UNA sola llamada (máx. 6). No hagas una llamada por sección.',
				},
				fecha: { type: 'string', description: 'YYYY-MM-DD hasta donde mirar en las secciones por fecha. Default hoy.' },
				dias: { type: 'integer', description: 'Días hacia atrás en las secciones por fecha. Default 7 (signos vitales 3).' },
				todas: { type: 'boolean', description: 'true = toda la internación' },
			},
			required: ['secciones'],
		},
		run: conVisita(hc.verHistoriaClinica),
	}),
	def({
		name: 'preparar_egreso',
		description:
			'Arma el egreso (alta) de un internado. Fecha y hora = ahora salvo que el usuario diga otra. Si falta el motivo devuelve las opciones del catálogo; cuando el usuario elige, se llama de nuevo con disposicion. NO egresa: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.MOVIMIENTOS.GESTIONAR'],
		modulo: 'INTERNACION',
		mutante: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: { type: 'string', description: 'Nombre, DNI o visita si el usuario nombra al paciente' },
				numeroVisita: P_VISITA,
				disposicion: {
					type: 'string',
					description: 'Motivo de egreso (texto del catálogo o código). Si el usuario ya lo dijo («por alta médica»), pasalo acá.',
				},
				fecha: P_FECHA,
				hora: { type: 'string', description: 'HH:MM. Default ahora.' },
				diagnosticoEgreso: {
					type: 'string',
					description: 'Solo un código CIE que el usuario dictó (ej. J18.9). Si no lo dijo, omitilo: se mantiene el de la internación.',
				},
			},
		},
		preparar: prepararEgreso,
	}),
	def({
		name: 'preparar_evolucion',
		description:
			'Arma una evolución médica para un internado con el texto que redactás a partir de lo que dictó el usuario. NO guarda: deja una tarjeta Confirmar con el texto; al confirmar queda marcada como generada con IA y firmada por el usuario.',
		permiso: ['INTERNACION.EVOLUCIONES.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: { type: 'string', description: 'Nombre, DNI o visita si el usuario nombra al paciente' },
				numeroVisita: P_VISITA,
				texto: { type: 'string', description: 'Texto final de la evolución, en español clínico' },
				fecha: P_FECHA,
				hora: { type: 'string', description: 'HH:MM. Default ahora.' },
			},
			required: ['texto'],
		},
		preparar: prepararEvolucion,
	}),
	def({
		name: 'preparar_hc_ingreso',
		description:
			'Arma la historia clínica de ingreso de un internado con lo que dictó el usuario (motivo, enfermedad actual, signos vitales, examen, impresión diagnóstica, planes). NO guarda: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.HISTORIA_CLINICA.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				motivoConsulta: { type: 'string' },
				enfermedadActual: { type: 'string', description: 'Redactada en español clínico con lo que dictó, sin agregar datos' },
				signosVitales: {
					type: 'object',
					additionalProperties: false,
					description: 'Solo los que dictó, tal cual (ej. ta "120/80", fc "88")',
					properties: {
						ta: { type: 'string' },
						fc: { type: 'string' },
						fr: { type: 'string' },
						temperatura: { type: 'string' },
						glucemia: { type: 'string' },
						peso: { type: 'string' },
						talla: { type: 'string' },
					},
				},
				examenFisico: {
					type: 'object',
					additionalProperties: false,
					properties: {
						general: { type: 'string' },
						respiratorio: { type: 'string' },
						cardiovascular: { type: 'string' },
						abdomen: { type: 'string' },
						neurologico: { type: 'string' },
					},
				},
				impresionDiagnostica: { type: 'string' },
				planDiagnostico: { type: 'array', items: { type: 'string' }, description: 'Un ítem por estudio/acción dictada' },
				planTerapeutico: { type: 'array', items: { type: 'string' }, description: 'Un ítem por conducta dictada' },
				comentario: { type: 'string' },
				fecha: P_FECHA,
				hora: P_HORA,
			},
		},
		preparar: sobreInternado(cargas.prepararHcIngreso),
	}),
	def({
		name: 'preparar_indicacion',
		description:
			'Indicación NO medicamentosa: control (signos vitales, TA, glucemia, diuresis, nebulizaciones…), medida asistencial (oxígeno, aislamiento, curaciones, kinesiología…) o dieta. El servidor busca el ítem en el catálogo; si hay varias opciones las devuelve. La medicación NO se indica desde el chat. NO guarda: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.INDICACIONES.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				tipo: { type: 'string', enum: ['control', 'medida_asistencial', 'dieta'], description: 'Omitilo si no estás seguro' },
				item: { type: 'string', description: 'Lo que se indica, como lo dijo el usuario (ej. «signos vitales», «dieta hiposódica», «oxígeno continuo»)' },
				frecuencia: { type: 'string', description: 'Ej. «cada 8 hs», «1 vez al día», «por turno». No aplica a dietas.' },
				cantidad: { type: 'number', description: 'Veces/unidades por toma si lo dijo. Default 1.' },
				observaciones: { type: 'string', description: 'Solo lo que dictó (máx. 255)' },
				fecha: { type: 'string', description: 'YYYY-MM-DD, hoy o mañana. Default hoy.' },
			},
			required: ['item'],
		},
		preparar: sobreInternado(cargas.prepararIndicacion),
	}),
	def({
		name: 'solicitar_estudios',
		description:
			'Pide uno o más estudios (Rx, TC, ecografía, ECG…) para un internado. El servidor busca las prácticas y deduce el servicio; si hay varias opciones las devuelve. NO pide: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.ESTUDIOS.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				estudios: { type: 'array', items: { type: 'string' }, description: 'Cada estudio como lo dijo el usuario o como vino en las opciones' },
				servicio: { type: 'string', description: 'Servicio destino solo si lo dijo' },
				urgencia: { type: 'string', enum: ['Normal', 'Urgente', 'Medio'] },
				notas: { type: 'string', description: 'Solo lo que dictó' },
			},
			required: ['estudios'],
		},
		preparar: sobreInternado(cargas.prepararEstudios),
	}),
	def({
		name: 'solicitar_interconsulta',
		description: 'Pide una interconsulta a un servicio (cardiología, infectología…) con el motivo dictado. NO pide: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.INTERCONSULTAS.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				servicio: { type: 'string', description: 'Servicio/especialidad como lo dijo el usuario' },
				motivo: { type: 'string', description: 'Motivo redactado con lo que dictó, sin agregar datos' },
				urgencia: { type: 'string', enum: ['Normal', 'Urgente', 'Medio'] },
			},
			required: ['servicio', 'motivo'],
		},
		preparar: sobreInternado(cargas.prepararInterconsulta),
	}),
	def({
		name: 'preparar_protocolo',
		description:
			'Carga el protocolo de un procedimiento hecho al internado (punción, colocación de catéter, cirugía…): genera también el procedimiento/práctica facturable. Vos (el usuario) quedás como especialista; sumá equipo solo si lo nombró. Sin medicamentos. NO guarda: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.PROTOCOLOS.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				practica: { type: 'string', description: 'Práctica realizada (nombre o código). Si antes devolvió opciones, la elegida por el usuario tal cual, con su código.' },
				texto: { type: 'string', description: 'Descripción del procedimiento con lo que dictó, sin agregar datos' },
				tipoProtocolo: { type: 'string', description: 'Tipo de protocolo solo si lo dijo' },
				tecnica: { type: 'string' },
				diagnosticoPre: { type: 'string', description: 'Código CIE si lo dictó' },
				diagnosticoPos: { type: 'string', description: 'Código CIE si lo dictó' },
				fechaFin: P_FECHA,
				horaFin: P_HORA,
				fechaInicio: P_FECHA,
				horaInicio: { type: 'string', description: 'HH:MM de inicio si lo dijo' },
				rolPropio: { type: 'string', description: 'Rol del usuario si no fue especialista (ayudante, anestesista…)' },
				equipo: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: false,
						properties: {
							profesional: { type: 'string' },
							funcion: { type: 'string', enum: ['especialista', 'ayudante_1', 'ayudante_2', 'ayudante_3', 'anestesista', 'instrumentista', 'monitoreo'] },
						},
						required: ['profesional', 'funcion'],
					},
				},
			},
			required: ['practica', 'texto'],
		},
		preparar: sobreInternado(cargas.prepararProtocolo),
	}),
	def({
		name: 'preparar_epicrisis',
		description:
			'Arma la epicrisis de la internación con el texto que redactás a partir de lo que dictó el usuario (o de lo que leíste de la HC si lo pidió). Diagnóstico solo si lo dijo. NO guarda: deja una tarjeta Confirmar; queda marcada como asistida por IA.',
		permiso: ['INTERNACION.EPICRISIS.CREAR'],
		modulo: 'INTERNACION',
		mutante: true,
		alta: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				texto: { type: 'string', description: 'Texto de la epicrisis' },
				diagnostico: { type: 'string', description: 'Código CIE o nombre del diagnóstico de egreso si lo dijo' },
				fecha: P_FECHA,
				hora: P_HORA,
			},
			required: ['texto'],
		},
		preparar: async (args, ctx) => {
			if (String(args.termino || '').trim()) return sobreInternado(cargas.prepararEpicrisis)(args, ctx);
			return conVisita(async (a, c) => conFocoDe(await cargas.prepararEpicrisis(a, c), c))(args, ctx);
		},
	}),
	def({
		name: 'editar_evolucion',
		description:
			'Reemplaza el texto de una evolución existente (idEvolucion = IdHCEvolucion de ver_evoluciones). Solo las del propio usuario (_propio true). NO guarda: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.EVOLUCIONES.EDITAR'],
		modulo: 'INTERNACION',
		mutante: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				idEvolucion: { type: 'integer', description: 'IdHCEvolucion de la evolución a modificar' },
				texto: { type: 'string', description: 'Texto completo nuevo de la evolución' },
			},
			required: ['idEvolucion', 'texto'],
		},
		preparar: sobreEvolucion(crud.prepararEditarEvolucion),
	}),
	def({
		name: 'eliminar_evolucion',
		description:
			'Borra una evolución (idEvolucion = IdHCEvolucion de ver_evoluciones). Solo las del propio usuario. NO borra: deja una tarjeta Confirmar con el texto que se elimina.',
		permiso: ['INTERNACION.EVOLUCIONES.ELIMINAR'],
		modulo: 'INTERNACION',
		mutante: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				idEvolucion: { type: 'integer', description: 'IdHCEvolucion de la evolución a borrar' },
			},
			required: ['idEvolucion'],
		},
		preparar: sobreEvolucion(crud.prepararEliminarEvolucion),
	}),
	def({
		name: 'listar_camas_libres',
		description: 'Camas libres (sin paciente y habilitadas) del hospital o de un sector. Para elegir destino de un traslado o una asignación.',
		permiso: ['INTERNACION.CAMAS.VER', 'INTERNACION.MOVIMIENTOS.VER'],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				sector: { type: 'string', description: 'Código o nombre del sector (ej. UTI, Clínica Médica)' },
			},
		},
		run: crud.camasLibres,
	}),
	def({
		name: 'ver_movimientos',
		description: 'Historial de camas/sectores de la visita: ingreso, traslados y egreso, con fechas, disposición y operador.',
		permiso: ['INTERNACION.MOVIMIENTOS.VER'],
		modulo: 'INTERNACION',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { numeroVisita: P_VISITA },
		},
		run: conVisita(crud.verMovimientos),
	}),
	def({
		name: 'trasladar_cama',
		description:
			'Traslada a un internado que YA tiene cama a otra cama libre. Sin cama destino devuelve las libres para que el usuario elija. NO mueve: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.MOVIMIENTOS.TRASLADAR', 'INTERNACION.MOVIMIENTOS.GESTIONAR'],
		modulo: 'INTERNACION',
		mutante: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				cama: P_CAMA,
				sector: P_SECTOR,
				fecha: P_FECHA,
				hora: P_HORA,
			},
		},
		preparar: sobreInternado(crud.prepararTraslado),
	}),
	def({
		name: 'asignar_cama',
		description:
			'Ubica en una cama libre a un internado que todavía NO tiene cama (internación sin ubicación). NO asigna: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.MOVIMIENTOS.TRASLADAR', 'INTERNACION.MOVIMIENTOS.GESTIONAR'],
		modulo: 'INTERNACION',
		mutante: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: P_VISITA,
				cama: P_CAMA,
				sector: P_SECTOR,
				fecha: { type: 'string', description: 'YYYY-MM-DD de ingreso a la cama. Default hoy.' },
				hora: P_HORA,
			},
		},
		preparar: async (args, ctx) => conFocoDe(await crud.prepararAsignarCama(args, ctx), ctx),
	}),
	def({
		name: 'revertir_egreso',
		description:
			'Deshace el egreso de una visita egresada por error: vuelve a internación (a su cama si sigue libre). Solo administradores. NO revierte: deja una tarjeta Confirmar.',
		permiso: ['INTERNACION.MOVIMIENTOS.GESTIONAR'],
		modulo: 'INTERNACION',
		mutante: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				termino: P_TERMINO,
				numeroVisita: { type: 'integer', description: 'Número de la visita egresada' },
			},
		},
		preparar: async (args, ctx) => conFocoDe(await crud.prepararRevertirEgreso(args, ctx), ctx),
	}),
	soporte.HERRAMIENTAS.find((h) => h.name === 'navegar'),
]);

/** Altas del menú médico (modo altas y todo). */
const REGLAS_ALTAS = [
	'- Cargar algo (evolución, HC de ingreso, indicación, estudio, interconsulta, protocolo, epicrisis): llamá la tool preparar_*/solicitar_* con el nombre del paciente en termino si lo nombró. Redactá los textos en español clínico con lo que dictó el usuario; podés ordenarlo y darle forma, pero NO agregues datos que no dijo (signos vitales, valores, estudios, diagnósticos, medicación, plan). No preguntes «¿querés que lo haga?»: llamá la tool y queda la tarjeta.',
	'- Si un pedido de carga queda a medias (faltaba el paciente, el usuario aclara «era Franco Matías»), volvé a llamar la MISMA tool con lo que había dictado antes y el paciente nuevo. Nunca muestres como hecho algo que no pasó por una tool: si no hay tarjeta, no se cargó nada.',
	'- Si la tool devuelve pedir/opciones (frecuencia, servicio, estudio, ítem del catálogo), mostrá las opciones tal cual y esperá que elija; después llamá de nuevo con la opción elegida, copiada exacta.',
	'- Indicaciones: solo controles, medidas asistenciales y dietas (preparar_indicacion). La MEDICACIÓN no se indica desde el chat: decilo y ofrecé abrir Indicaciones con navegar.',
	'- Procedimiento hecho (punción, catéter, cirugía…): preparar_protocolo; genera la práctica facturable. Estudio a pedir (Rx, TC, eco, ECG): solicitar_estudios. Opinión de otra especialidad: solicitar_interconsulta.',
	'- Todas las cargas quedan en una tarjeta Confirmar: un «sí» en el chat no ejecuta. Respondé en una línea, con voseo: «Preparé <qué> para <paciente>: confirmá en la tarjeta.» Nunca digas «cargué», «solicité», «se ha registrado» ni «confirma»/«verifica».',
	'- Práctica de protocolo (se factura): si preparar_protocolo devuelve opciones, mostralas con su código y esperá que el usuario elija; nunca elijas vos. Pasá la opción elegida tal cual (con el código).',
];

/** Escrituras de camas/egresos y editar/borrar: solo en modo todo. */
const REGLAS_ESCRITURA = [
	'- Egreso / “dar de alta” a un internado: preparar_egreso, con el nombre en termino y el motivo en disposicion si el usuario lo dijo. Si devuelve opciones de motivo, mostralas y esperá que elija. Queda una tarjeta Confirmar: un «sí» en el chat no ejecuta.',
	'- Cuando el usuario responde el motivo («alta medica», «derivado»…), llamá preparar_egreso YA con disposicion. Nunca pidas confirmación por chat («escribí sí», «¿confirmás?»): la única confirmación es el botón de la tarjeta.',
	'- Diagnóstico de egreso: respondé con diagnosticoEgreso / el resumen de preparar_egreso, no con evoluciones.',
	'- Egreso hecho por error / “volver a internar”: revertir_egreso (solo admin). Si devuelve conflictos, explicalos y no insistas.',
	'- Corregir o borrar una evolución: primero ver_evoluciones para tener el IdHCEvolucion; después editar_evolucion (texto completo nuevo) o eliminar_evolucion. Solo las que tienen _propio true; si es de otro profesional, decilo y no ofrezcas hacerlo.',
	'- Traslado de cama: trasladar_cama. Si el usuario no dijo la cama, la tool devuelve las libres: mostralas y esperá que elija. Para ver opciones antes: listar_camas_libres.',
	'- Internado que todavía no tiene cama: asignar_cama (no trasladar_cama).',
];

const REGLA_SIN_EDICION =
	'- Desde el chat todavía NO se egresa, traslada, asigna cama, revierte un egreso ni se edita o borra nada. Si piden algo de eso, empezá diciendo «Eso todavía no está habilitado en el asistente» y ofrecé abrir la pantalla con navegar. No listes camas «para trasladar»: listar_camas_libres solo si preguntan qué camas hay libres.';

const REGLA_SOLO_LECTURA =
	'- Por ahora desde el chat SOLO se consulta. Si piden cargar, egresar, trasladar, editar o borrar algo, decí que eso todavía no está habilitado en el asistente y ofrecé abrir la pantalla con navegar.';

function reglasDeModo(modo) {
	if (modo === 'lectura') return [REGLA_SOLO_LECTURA];
	if (modo === 'altas') return [...REGLAS_ALTAS, REGLA_SIN_EDICION];
	return [...REGLAS_ALTAS, ...REGLAS_ESCRITURA];
}

const PRESENTACION = {
	lectura: 'Consultás camas, visitas y HC de internados (solo lectura).',
	altas: 'Consultás la HC de internados y preparás cargas del menú médico (evoluciones, HC de ingreso, indicaciones no medicamentosas, estudios, interconsultas, protocolos, epicrisis) que el usuario confirma en una tarjeta.',
	todo: 'Operás camas, visitas y HC de internados: ver, cargar del menú médico, trasladar, asignar cama, egresar, revertir egreso y editar/borrar evoluciones.',
};

function instrucciones() {
	const modo = modoEscritura();
	return [
		'Operás el módulo de INTERNACIÓN de iMedic, con voseo (vos, tenés, indicá). Nunca «tú».',
		`${PRESENTACION[modo]} No das turnos ni altas de personal.`,
		'Si el mensaje es un pedido de ayuda sobre una pantalla de internación («cómo cargo una evolución», «no me deja egresar»), resolvelo con las tools de ayuda; usá las de este módulo solo si hace falta un dato del paciente.',
		'Respondé SOLO lo que se pidió en este mensaje, con el resultado de la tool de este turno. No repitas resúmenes de turnos anteriores.',
		'',
		'Método:',
		'- Nombre / DNI / “dónde está”: buscar_internado. Mostrá la ficha entera. Si hay varios, preguntá cuál.',
		'- Con un internado en foco no hace falta pasar numeroVisita: las tools usan esa visita.',
		'- Si el usuario NOMBRA a un paciente, ese manda: pasá su nombre en termino (o buscalo con buscar_internado). No uses la visita de la pantalla, la ruta ni el foco para otro paciente.',
		'- Nombrá al paciente SIEMPRE como lo devuelve la tool (paciente), nunca como lo escribió el usuario. Si la tool devuelve otro paciente que el pedido, decilo y no sigas.',
		'- Estudios de esa visita: ver_estudios. “Hechos/cumplidos/realizados” → filtro hechos. Nunca uses una bandeja hospitalaria de pendientes para eso.',
		'- Evoluciones: ver_evoluciones. Indicaciones: ver_indicaciones. Resumí, no pegues todo el texto. Si la tool trae «aviso», decilo tal cual.',
		'- HC de ingreso, laboratorios, signos vitales, medicación suministrada, interconsultas, enfermería, balance, dieta, epicrisis, protocolos, procedimientos, insumos, adjuntos: ver_historia_clinica con esas secciones (varias en una llamada).',
		'- Análisis / resumen clínico del internado: juntá ficha, evoluciones, indicaciones, estudios y ver_historia_clinica (hc_ingreso, laboratorios, signos_vitales, medicacion, interconsultas). Basate solo en lo que devuelven las tools; si una sección vino vacía o sin permiso, decilo. No agregues diagnósticos ni conductas que no estén registrados.',
		'- Llamá SOLO las tools/secciones de lo que se pidió: «evoluciones» → ver_evoluciones y nada más; «signos» → solo signos_vitales. Juntá varias fuentes únicamente si pide un análisis o resumen clínico general.',
		'- En los resúmenes, items va ordenado por la última vez (no por cantidad); para «lo más usado» usá masFrecuentes. Si un valor mínimo o máximo es fisiológicamente imposible (ej. pulso 7), decí que parece un error de carga, sin interpretarlo.',
		'- Si una sección viene con resumido: true, trae un resumen calculado de TODOS sus registros (resumen) más los últimos (registros): alcanza para responder; usalo como dato real y citá cantidades y fechas tal cual. Una sola llamada con todas las secciones que hagan falta: NO repitas la llamada por sección para ampliar. Solo si el usuario pide más detalle de algo puntual, llamá esa sección sola o con un período (fecha/dias). No escribas vos un aviso de «resumen»: el chat ya lo agrega.',
		'- Historial de camas / traslados / cuándo ingresó a cada sector: ver_movimientos.',
		...reglasDeModo(modo),
		'- Si algo no tiene tool, decí que el asistente todavía no lo hace. Nunca digas que el usuario no tiene permiso sin haber llamado la tool y recibido «Sin permiso».',
		'- Abrir la HC: navegar a /dashboard/visita/<numeroVisita> con query { seccion }.',
		'- No escribas URLs ni links: el chat ya muestra el botón para abrir la pantalla.',
		'- No listes endpoints. No inventes diagnósticos, resultados ni tratamientos.',
	].join('\n');
}

module.exports = { ID, LISTO, HERRAMIENTAS, instrucciones, modoEscritura, escrituraHabilitada };
