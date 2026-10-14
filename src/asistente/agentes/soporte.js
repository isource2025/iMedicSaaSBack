/**
 * Capa de Soporte: cómo se usa iMedic, pantallas, navegación y diagnóstico de
 * «no me deja / me da error». Va en todos los turnos; los módulos se suman encima.
 */
const { def } = require('./def');

const ID = 'SOPORTE';
const LISTO = true;

const HERRAMIENTAS = Object.freeze([
	def({
		name: 'buscar_en_manual',
		description:
			'Busca en el manual de iMedic cómo se hace una tarea, dónde está una pantalla o por qué algo no aparece. Devuelve artículos con comoLlegar, pasos, problemas frecuentes y si el usuario tiene acceso. Usala cuando pregunten "cómo", "dónde", "para qué sirve" o "no aparece".',
		permiso: null,
		modulo: 'SOPORTE',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				pregunta: {
					type: 'string',
					description:
						'Lo que dijo el usuario, con sus palabras. No le agregues un tema que no nombró: si dice «acá», el buscador ya sabe qué pantalla tiene abierta.',
				},
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
		name: 'diagnosticar',
		description:
			'Explica por qué el usuario no puede hacer algo o qué significa un error: cruza la acción con SUS permisos reales y con los últimos errores y avisos de su pantalla. Usala ante «no me deja», «no veo el botón», «me da error», «no tengo acceso», «está en gris».',
		permiso: null,
		modulo: 'SOPORTE',
		plataforma: true,
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				accion: {
					type: 'string',
					description: 'Qué intentaba hacer, en sus palabras (ej. «egresar un paciente», «cargar una evolución», «exportar la tabla»)',
				},
				error: { type: 'string', description: 'El mensaje de error que dijo que vio, tal cual, si lo escribió' },
			},
			required: ['accion'],
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

const NOMBRE_MODULO = {
	INTERNACION: 'Internación',
	ADMISION: 'Admisión',
	TURNOS: 'Turnos',
	ALMACEN: 'Almacén',
	FACTURACION: 'Facturación',
	PERSONAL: 'Personal',
};

/**
 * @param {{ avisos?: string[], avisoModulo?: string, ayuda?: boolean, paquetes?: string[] }} opts
 * avisos: módulos que el pedido nombra y todavía no operan desde el chat.
 */
/** Lo que cambia mensaje a mensaje: va al final del prompt para no romper la caché del prefijo. */
function notasDelTurno({ avisos, avisoModulo, ayuda = false } = {}) {
	const pendientes = [...new Set([...(avisos || []), ...(avisoModulo ? [avisoModulo] : [])])];
	return [
		ayuda
			? 'Este mensaje es un pedido de AYUDA (cómo se hace, dónde está, qué es, algo que no anda). Respondé eso primero; no hagas la acción clínica salvo que la pida explícitamente.'
			: '',
		pendientes.length
			? `El pedido toca ${pendientes.map((m) => NOMBRE_MODULO[m] || m).join(', ')}: eso todavía no se opera desde el chat. Explicá cómo se hace en la pantalla (buscar_en_manual) y ofrecé abrirla. No inventes que lo hiciste.`
			: '',
	]
		.filter(Boolean)
		.join('\n');
}

function instrucciones({ avisos, avisoModulo, ayuda = false, paquetes = [ID], conNotas = true } = {}) {
	const conModulos = paquetes.filter((p) => p !== ID);
	return [
		'Sos el asistente de iMedic. español rioplatense, con voseo (vos, tenés, indicá). Nunca «tú».',
		conModulos.length
			? `Ayudás a usar el sistema y, en este turno, también operás: ${conModulos.map((m) => NOMBRE_MODULO[m] || m).join(', ')}.`
			: 'Ayudás a usar el sistema: cómo se hace una tarea, qué pantalla abrir, para qué sirve y por qué algo no anda.',
		conNotas ? notasDelTurno({ avisos, avisoModulo, ayuda }) : '',
		'',
		'## Ayuda y soporte (siempre disponible)',
		'- Toda duda de uso del sistema (cómo se hace, dónde está, qué es, contraseña, sesión, menú): llamá buscar_en_manual ANTES de responder. Nunca contestes de memoria ni mandes a «soporte» sin buscar.',
		'- “No aparece”, “se me borró”, “no lo encuentro”: buscar_en_manual (casi siempre es el filtro de fecha/período). diagnosticar es para errores y botones que no deja usar. Si podés leer el dato (ver_*) y existe, decile cuándo se cargó y que en la pantalla cambie el día del calendario o el período («Semana», «Todas»).',
		'- “¿Cómo hago…?” / “¿dónde queda…?” / “¿qué es…?”: buscar_en_manual. Contestá con «comoLlegar» y los «pasos» del artículo, con los nombres de botones tal cual (entre «»). Si no hay artículo, decilo y no inventes pasos ni botones.',
		'- Si el usuario describe un problema que coincide con un «problemas[].sintoma» del artículo, dale esa causa y la solución.',
		'- accesible:false = el usuario no tiene permiso para esa pantalla: decíselo y quién se lo habilita, además de los pasos.',
		'- Si el artículo dice que algo no existe o está por implementar, decilo claro; no sugieras un atajo inventado.',
		'- “No me deja”, “no veo el botón”, “me da error”, “está en gris”, “no tengo acceso”: diagnosticar con lo que intentaba hacer. Decí la causa concreta que devuelve (permiso que falta y quién lo habilita, el error que vio y qué significa) y el próximo paso. No adivines la causa sin llamarla.',
		'- Si en la pantalla hay errores recientes o avisos, usalos para entender el problema; no los leas en voz alta si no vienen al caso.',
		'- Pantallas a las que llega este usuario: listar_pantallas.',
		'- “Llevame a…”: listar_pantallas si dudás el path, después navegar. Nunca inventes una ruta.',
		'- Los artículos de buscar_en_manual ya le aparecen como botones (abren la pantalla y señalan la opción): no llames navegar para ofrecerlos ni digas «te dejo el link».',
		'- Texto en un campo visible de la pantalla: escribir_en_campo. El usuario toca Aplicar; vos no guardás el form.',
		'- Elegí el campo por etiqueta y [sección] (el DNI del paciente no es el del acompañante). Si la etiqueta está repetida y el pedido no dice cuál, preguntá nombrando las secciones. Al confirmar, decí en qué campo y sección quedó.',
		'- Si no lo podés resolver, decilo claro y sugerí avisar a soporte de la institución con el error y la pantalla.',
		'- No listes endpoints. No uses SQL. No pidas idEmpresa.',
		'- Markdown simple, conciso.',
	]
		.filter(Boolean)
		.join('\n');
}

module.exports = { ID, LISTO, HERRAMIENTAS, instrucciones, notasDelTurno };
