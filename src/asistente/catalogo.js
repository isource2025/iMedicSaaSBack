/**
 * Catálogo por agente. El chat solo ve las tools del especialista activo.
 * Las primitivas de código/API quedan ocultas (siguen en AVANZADAS para tests/ejecutar).
 */
const { AVANZADAS } = require('./herramientasAvanzadas');
const orquestador = require('./agentes/orquestador');
const { def } = require('./agentes/def');

/** Primitivas viejas: ejecutar/tests las resuelven, el chat de un agente no las ve. */
const OCULTAS = Object.freeze([
	def({
		name: 'resolver_contexto',
		description: 'Ubica un registro y arma la ficha.',
		permiso: null,
		modulo: 'PLATAFORMA',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { texto: { type: 'string' } },
			required: ['texto'],
		},
	}),
	def({
		name: 'consultar',
		description: 'Lee datos de la ficha.',
		permiso: null,
		modulo: 'PLATAFORMA',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { texto: { type: 'string' } },
			required: ['texto'],
		},
	}),
	def({
		name: 'buscar_codigo',
		description: 'Busca endpoints y archivos del proceso.',
		permiso: null,
		modulo: 'PLATAFORMA',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { texto: { type: 'string' }, modulo: { type: 'string' }, carpeta: { type: 'string' } },
			required: ['texto'],
		},
	}),
	def({
		name: 'leer_codigo',
		description: 'Lee un handler o archivo.',
		permiso: null,
		modulo: 'PLATAFORMA',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				archivo: { type: 'string' },
				handler: { type: 'string' },
				metodo: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
				path: { type: 'string' },
			},
		},
	}),
]);

const HERRAMIENTAS = Object.freeze([...orquestador.todasHerramientas(), ...AVANZADAS, ...OCULTAS]);

const MAX_TOOLS = Number(process.env.ASISTENTE_MAX_TOOLS || 32);

function permitido(h, permisos, check) {
	if (!h.permiso) return true;
	const lista = Array.isArray(h.permiso) ? h.permiso : [h.permiso];
	return lista.some((p) => check(permisos, p));
}

function aOpenAi(h) {
	return {
		type: 'function',
		function: {
			name: h.name,
			description: h.description,
			parameters: h.parameters || { type: 'object', properties: {} },
		},
	};
}

function porNombre(name) {
	return HERRAMIENTAS.find((h) => h.name === name) || null;
}

function esEscritura(h) {
	return Boolean(h.mutante || h.etapa === 'actuar');
}

/** El agente puede apagar escrituras por env (ej. Internación: solo altas del menú médico). */
function escrituraBloqueada(h, spec) {
	return esEscritura(h) && typeof spec?.escrituraHabilitada === 'function' && !spec.escrituraHabilitada(h);
}

/** Bloqueada en algún agente que la tenga (navegar es de Soporte y de Internación, pero no escribe). */
function bloqueadaPorAgente(h) {
	return Object.values(orquestador.AGENTES).some((a) => (a.HERRAMIENTAS || []).includes(h) && escrituraBloqueada(h, a));
}

/**
 * Tools del turno. `paquetes` (Soporte + módulos) manda sobre `agente`, que queda
 * para pedir las de un solo agente.
 */
function seleccionar({
	permisos,
	agente = 'SOPORTE',
	paquetes,
	moduloActual,
	tienePermiso,
	puedeSql = false,
	soloLectura = false,
}) {
	const check = typeof tienePermiso === 'function' ? tienePermiso : () => false;
	const ids = Array.isArray(paquetes) && paquetes.length ? paquetes : [agente];
	let specs = ids.map((id) => orquestador.porId(id)).filter(Boolean);
	if (!specs.length) specs = [orquestador.porId('SOPORTE')];
	const vistas = new Set();
	const permitidas = [];
	for (const spec of specs) {
		for (const h of spec.HERRAMIENTAS || []) {
			if (vistas.has(h.name)) continue;
			vistas.add(h.name);
			const bloqueada = specs.some((s) => (s.HERRAMIENTAS || []).includes(h) && escrituraBloqueada(h, s));
			if (
				!h.descubrimiento &&
				permitido(h, permisos, check) &&
				(!h.sql || puedeSql) &&
				!(soloLectura && esEscritura(h)) &&
				!bloqueada
			) {
				permitidas.push(h);
			}
		}
	}
	return permitidas.slice(0, MAX_TOOLS);
}

module.exports = {
	HERRAMIENTAS,
	aOpenAi,
	porNombre,
	permitido,
	seleccionar,
	MAX_TOOLS,
	esEscritura,
	bloqueadaPorAgente,
};
