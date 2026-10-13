/**
 * Primitivas de datos: SQL de lectura, manifiesto de API y RENAPER.
 * El proceso clínico sale del código (buscar_codigo / leer_codigo + llamar_api), no de tools por pantalla.
 */
const personas = require('./personas');

function def(spec) {
	return Object.freeze({ global: false, mutante: false, plataforma: false, sql: false, ...spec });
}

const AVANZADAS = Object.freeze([
	def({
		name: 'consulta_sql',
		description:
			'Ejecuta una consulta SQL Server de SOLO LECTURA (SELECT/WITH) sobre la base de esta clínica. Para conteos, cruces y estadísticas. Usá describir_tabla antes si no conocés las columnas. Siempre poné TOP.',
		permiso: null,
		modulo: 'DATOS',
		global: true,
		sql: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				sql: { type: 'string', description: 'Una sola sentencia SELECT o WITH ... SELECT' },
				motivo: { type: 'string', description: 'Qué pregunta responde' },
			},
			required: ['sql'],
		},
	}),
	def({
		name: 'listar_tablas',
		description: 'Lista tablas de la base clínica (dbo), filtrando por nombre.',
		permiso: null,
		modulo: 'DATOS',
		global: true,
		sql: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { filtro: { type: 'string', description: 'Parte del nombre, ej. Evolucion, Ctrl, Visita' } },
		},
	}),
	def({
		name: 'describir_tabla',
		description: 'Columnas y tipos de una tabla de la base clínica.',
		permiso: null,
		modulo: 'DATOS',
		global: true,
		sql: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: { tabla: { type: 'string' } },
			required: ['tabla'],
		},
	}),

	def({
		name: 'buscar_endpoints',
		description:
			'Índice interno de endpoints. NUNCA copies esta lista al usuario: después llamá consultar o llamar_api. Si hay ficha y pide datos (estudios, evoluciones), usá consultar.',
		permiso: null,
		modulo: 'API',
		global: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				texto: {
					type: 'string',
					description: 'Términos del proceso: egreso, admision, evolucion, personal, cama…',
				},
				modulo: { type: 'string', description: 'TURNOS, ADMISION, INTERNACION, FACTURACION, ALMACEN, CONFIGURACION…' },
				metodo: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
			},
			required: ['texto'],
		},
	}),
	def({
		name: 'describir_endpoint',
		description: 'Detalle de UN endpoint ya elegido: permisos y campos de body/query que lee el controlador. Antes de un POST/PUT.',
		permiso: null,
		modulo: 'API',
		global: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				metodo: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
				path: { type: 'string', description: 'Path concreto o patrón, ej. /api/indicaciones/123' },
			},
			required: ['metodo', 'path'],
		},
	}),
	def({
		name: 'llamar_api',
		description:
			'Llama un endpoint REAL del manifiesto con la sesión del usuario. GET se ejecuta; POST/PUT/PATCH/DELETE quedan pendientes de Confirmar. No inventes el path: primero buscar_codigo o buscar_endpoints.',
		permiso: null,
		modulo: 'API',
		global: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				metodo: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
				path: { type: 'string', description: 'Path concreto con parámetros resueltos, ej. /api/indicaciones/4521' },
				query: { type: 'object', additionalProperties: true },
				body: { type: 'object', additionalProperties: true },
				resumen: { type: 'string', description: 'Qué hace la acción, en lenguaje claro (para la tarjeta de confirmación)' },
				camposGenerados: {
					type: 'array',
					items: { type: 'string' },
					description:
						'SOLO campos de texto libre que redactaste vos. NUNCA fechas, números, documento, nombre, catálogos. Se marcan como generados con IA.',
				},
			},
			required: ['metodo', 'path'],
		},
	}),
	def({
		name: 'buscar_persona_renaper',
		etapa: 'actuar',
		description:
			'Trae los datos personales de un DNI desde RENAPER para precargar un alta de personal o de un paciente NUEVO. No la uses para dar de alta / egresar a un internado.',
		permiso: ['CONFIGURACION.PERSONAL.CREAR', 'CONFIGURACION.PERSONAL.EDITAR', 'ADMISION.PACIENTES.CREAR', 'ADMISION.PACIENTES.EDITAR'],
		modulo: 'CONFIGURACION',
		global: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				documento: { type: 'string' },
				sexo: { type: 'string', enum: ['M', 'F'] },
			},
			required: ['documento'],
		},
		run: (args, ctx) => personas.buscarPersona(args, ctx),
	}),
]);

module.exports = { AVANZADAS };
