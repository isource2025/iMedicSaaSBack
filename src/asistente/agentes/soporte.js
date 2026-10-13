/**
 * Agente de Soporte: cómo se usa iMedic, pantallas y navegación.
 * No opera HC, internación, admisión ni escrituras clínicas.
 */
const { def } = require('./def');

const ID = 'SOPORTE';
const LISTO = true;

const HERRAMIENTAS = Object.freeze([
	def({
		name: 'buscar_en_manual',
		description:
			'Busca en el manual de iMedic cómo se hace una tarea o dónde está una pantalla. Usala cuando pregunten "cómo", "dónde" o "para qué sirve".',
		permiso: null,
		modulo: 'SOPORTE',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				pregunta: { type: 'string', description: 'Qué quiere hacer o encontrar el usuario' },
			},
			required: ['pregunta'],
		},
	}),
	def({
		name: 'listar_pantallas',
		description: 'Lista las pantallas del sistema a las que este usuario tiene acceso, con su ruta.',
		permiso: null,
		modulo: 'SOPORTE',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				filtro: { type: 'string', description: 'Texto opcional para filtrar por nombre' },
			},
		},
	}),
	def({
		name: 'navegar',
		description:
			'Prepara la navegación a una pantalla de iMedic. El front abre esa ruta. Usá paths del listado de pantallas. No sirve para Super Admin de otras empresas.',
		permiso: null,
		modulo: 'SOPORTE',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				path: {
					type: 'string',
					description: 'Ruta interna, ej. /dashboard/patients o /dashboard/beds',
				},
				query: {
					type: 'object',
					description: 'Query string opcional, ej. { tab: "articulos" }',
					additionalProperties: { type: 'string' },
				},
				motivo: { type: 'string', description: 'Por qué se abre esa pantalla' },
			},
			required: ['path'],
		},
	}),
	def({
		name: 'escribir_en_campo',
		description:
			'Propone texto para un campo editable de la pantalla actual. El usuario lo revisa y toca Aplicar; recién ahí se escribe, con la marca de IA. No guarda el formulario.',
		permiso: null,
		modulo: 'SOPORTE',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				campoId: { type: 'string', description: 'id del campo, ej. c3' },
				texto: { type: 'string', description: 'Texto final a escribir (sin la marca de IA, se agrega sola)' },
				modo: { type: 'string', enum: ['reemplazar', 'agregar'], description: 'agregar = al final del contenido actual' },
				motivo: { type: 'string' },
			},
			required: ['campoId', 'texto'],
		},
	}),
]);

function instrucciones({ avisoModulo } = {}) {
	return [
		'Sos el agente de SOPORTE de iMedic. español rioplatense.',
		'Ayudás a usar el sistema: cómo se hace una tarea, qué pantalla abrir, para qué sirve. No operás internación, admisión, turnos, HC ni cargás datos clínicos.',
		avisoModulo
			? `El pedido parece de ${avisoModulo}, módulo todavía no activo. Explicá cómo se hace en iMedic (manual/pantalla) y que la acción clínica la toma ese módulo cuando esté listo. No inventes que egresaste, internaste o pediste un estudio.`
			: 'Si piden egresar, internar, ver estudios de un paciente o cargar HC, decí que eso lo toma el módulo de Internación/Admisión (aún en construcción) y, si sirve, mostrá la pantalla desde el manual.',
		'',
		'Método:',
		'- “¿Cómo hago…?” / “¿dónde queda…?”: buscar_en_manual.',
		'- Listar pantallas a las que este usuario llega: listar_pantallas.',
		'- “Llevame a…”: listar_pantallas si dudás el path, después navegar. Nunca inventes una ruta.',
		'- Texto en un campo visible de la pantalla: escribir_en_campo. El usuario toca Aplicar; vos no guardás el form.',
		'- No listes endpoints. No uses SQL. No pidas idEmpresa.',
		'- Markdown simple, conciso.',
	].join('\n');
}

module.exports = { ID, LISTO, HERRAMIENTAS, instrucciones };
