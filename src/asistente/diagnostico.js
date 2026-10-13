/**
 * «No me deja», «no veo el botón», «me da error»: cruza lo que el usuario intentaba
 * con sus permisos reales y con los errores que vio en pantalla. Determinístico:
 * el modelo solo explica lo que sale de acá.
 */
const { MODULOS, todosLosCodigos } = require('../utils/permisos');
const descripciones = require('../utils/permisosDescripciones');
const manual = require('./manual');

const MAX_CANDIDATOS = 4;

let codigosMatriz = null;
function existeEnMatriz(codigo) {
	if (!codigosMatriz) codigosMatriz = new Set(todosLosCodigos().map((c) => c.codigo));
	return codigosMatriz.has(codigo);
}

function norm(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/** Sin la terminación: «evoluciones» ≈ «evolución», «egresar» ≈ «egreso». */
function raiz(t) {
	return t.length > 4 ? t.replace(/(aciones|acion|iones|ion|ar|er|ir|as|os|es|a|o|s)$/, '') : t;
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'al', 'a', 'y', 'en', 'me', 'mi', 'no', 'que', 'se', 'lo', 'para', 'por', 'con', 'deja', 'puedo', 'quiero', 'boton']);

function raices(s) {
	return norm(s)
		.split(' ')
		.filter((t) => t.length > 1 && !STOP.has(t))
		.map(raiz);
}

/** Verbos del usuario → acción de la matriz. */
const VERBOS = Object.freeze({
	VER: ['ver', 'veo', 'mirar', 'consultar', 'abrir', 'entrar', 'acceder', 'acceso', 'listar', 'buscar', 'aparece'],
	CREAR: ['crear', 'cargar', 'agregar', 'nueva', 'nuevo', 'pedir', 'solicitar', 'dar', 'registrar', 'alta', 'guardar', 'subir'],
	EDITAR: ['editar', 'modificar', 'cambiar', 'corregir', 'actualizar'],
	ELIMINAR: ['eliminar', 'borrar', 'anular', 'cancelar', 'quitar', 'sacar'],
	TRASLADAR: ['trasladar', 'traslado', 'mover', 'reubicar', 'intercambiar', 'asignar'],
	GESTIONAR: ['egresar', 'egreso', 'externar', 'revertir', 'gestionar', 'administrar', 'estado'],
	EXPORTAR: ['exportar', 'descargar', 'excel', 'bajar'],
	IMPRIMIR: ['imprimir', 'pdf'],
	APLICAR: ['aplicar', 'cumplir', 'marcar', 'suministrar'],
});
const VERBO_DE = new Map(Object.entries(VERBOS).flatMap(([acc, vs]) => vs.map((v) => [raiz(v), acc])));

/** Palabras del usuario que no aparecen en la etiqueta del submódulo. */
const SINONIMOS = Object.freeze({
	'INTERNACION.CAMAS': ['cama', 'mapa', 'ocupacion', 'internado'],
	'INTERNACION.MOVIMIENTOS': ['egreso', 'egresar', 'alta', 'traslado', 'trasladar', 'cama', 'revertir', 'externar'],
	'INTERNACION.ESTUDIOS': ['estudio', 'rx', 'radiografia', 'tomografia', 'eco', 'ecografia', 'ecg'],
	'INTERNACION.HISTORIA_CLINICA': ['hc', 'ingreso', 'historia'],
	'INTERNACION.SIGNOS_VITALES': ['signos', 'presion', 'temperatura', 'control'],
	'INTERNACION.MEDICACION': ['medicamento', 'medicacion', 'droga'],
	'ADMISION.PACIENTES': ['paciente', 'padron', 'dni'],
	'TURNOS.AGENDA': ['turno', 'cita', 'agenda'],
	'CONFIGURACION.ROLES': ['rol', 'roles', 'permiso', 'permisos'],
	'CONFIGURACION.PERSONAL': ['medico', 'empleado', 'usuario', 'cuenta', 'firma'],
});

let indice = null;

/** Un registro por permiso de la matriz, con las raíces de su módulo, pantalla y descripción. */
function indiceMatriz() {
	if (indice) return indice;
	indice = [];
	for (const mod of MODULOS) {
		if (mod.id === 'PLATAFORMA') continue;
		for (const sub of mod.submodulos) {
			const clave = `${mod.id}.${sub.id}`;
			const tema = new Set([
				...raices(sub.label),
				...raices(sub.id.replace(/_/g, ' ')),
				...raices(descripciones.descripcionSubmodulo(mod.id, sub.id)),
				...(SINONIMOS[clave] || []).map(raiz),
			]);
			const modulo = new Set(raices(mod.label));
			for (const acc of sub.acciones || []) {
				const codigo = `${clave}.${acc}`;
				indice.push({
					codigo,
					accion: acc,
					tema,
					modulo,
					pantalla: sub.label,
					modLabel: mod.label,
					path: sub.path || null,
					que: descripciones.descripcionPermiso(codigo),
				});
			}
		}
	}
	return indice;
}

/** Permisos de la matriz que mejor describen lo que el usuario intentaba. */
function candidatos(accionTexto) {
	const rs = raices(accionTexto);
	const verbos = new Set(rs.map((r) => VERBO_DE.get(r)).filter(Boolean));
	const temas = rs.filter((r) => !VERBO_DE.has(r));
	// «egresar» es verbo y tema a la vez: también cuenta para elegir el submódulo.
	const temasConVerbo = [...temas, ...rs.filter((r) => VERBO_DE.get(r) === 'GESTIONAR' || VERBO_DE.get(r) === 'TRASLADAR')];
	const puntaje = (e) => {
		const tema = temasConVerbo.filter((t) => e.tema.has(t)).length * 3 + temas.filter((t) => e.modulo.has(t)).length;
		if (!tema) return 0;
		const verbo = verbos.size ? (verbos.has(e.accion) ? 4 : 0) : e.accion === 'VER' ? 1 : 0;
		return tema + verbo;
	};
	const puntuados = indiceMatriz()
		.map((e) => ({ e, p: puntaje(e) }))
		.filter((x) => x.p > 0)
		.sort((a, b) => b.p - a.p);
	const mejor = puntuados[0]?.p || 0;
	// Solo los empatados arriba: el segundo escalón suele ser ruido («paciente» aparece en medio sistema).
	return puntuados
		.filter((x) => x.p === mejor)
		.slice(0, MAX_CANDIDATOS)
		.map((x) => x.e);
}

const CODIGO_PERMISO = /\b([A-Z_]{3,}\.[A-Z_]{2,}\.[A-Z_]{2,})\b/;

/** Mensajes conocidos del backend → qué significan para el usuario. */
const CONOCIDOS = Object.freeze([
	{
		re: /restricciones legales|creados por otro profesional|REGISTRO_AJENO/i,
		causa: 'registro_ajeno',
		explicacion: 'Ese registro lo cargó otro profesional: solo el autor (o un administrador clínico) lo puede modificar o borrar.',
	},
	{
		re: /inactividad|sesi[oó]n (expirada|vencida)|token (expirado|inv[aá]lido)/i,
		causa: 'sesion',
		explicacion: 'La sesión venció. Hay que volver a iniciar sesión; lo que no se guardó se pierde.',
	},
	{
		re: /egresad/i,
		causa: 'visita_egresada',
		explicacion: 'La visita ya está egresada: no se cargan registros nuevos. Si el egreso fue un error, un administrador lo puede revertir desde Movimientos.',
	},
	{
		re: /ya existe|duplicad/i,
		causa: 'duplicado',
		explicacion: 'Ya hay un registro con esos datos.',
	},
]);

function explicarStatus(status) {
	const s = Number(status);
	if (!Number.isFinite(s) || s === 0) return { causa: 'red', explicacion: 'No hubo respuesta del servidor: puede ser la conexión o que el servidor no esté disponible.' };
	if (s === 401) return { causa: 'sesion', explicacion: 'La sesión venció o no es válida. Hay que volver a iniciar sesión.' };
	if (s === 403) return { causa: 'permiso', explicacion: 'El servidor rechazó la acción por permisos (o porque el registro es de otro profesional).' };
	if (s === 404) return { causa: 'no_existe', explicacion: 'El registro ya no existe o se movió. Conviene recargar la pantalla.' };
	if (s === 409) return { causa: 'duplicado', explicacion: 'Ya existe un registro con esos datos.' };
	if (s === 400 || s === 422) return { causa: 'dato_invalido', explicacion: 'Falta un dato obligatorio o hay uno con formato inválido.' };
	if (s === 413) return { causa: 'muy_grande', explicacion: 'El archivo o el texto es demasiado grande.' };
	if (s >= 500) return { causa: 'servidor', explicacion: 'Falla del sistema, no del usuario. Si se repite, hay que avisar a soporte con la hora y la pantalla.' };
	return { causa: 'otro', explicacion: `El servidor respondió ${s}.` };
}

/** Explicación de un error: primero el mensaje (más preciso), después el status. */
function explicarError({ status, mensaje } = {}) {
	const m = String(mensaje || '');
	const conocido = CONOCIDOS.find((c) => c.re.test(m));
	const codigo = m.match(CODIGO_PERMISO)?.[1] || null;
	if (conocido) return { causa: conocido.causa, explicacion: conocido.explicacion, permiso: codigo };
	if (codigo && !existeEnMatriz(codigo)) {
		return {
			causa: 'permiso_inexistente',
			explicacion: `El servidor pide ${codigo}, que no existe en la Matriz de permisos: ningún rol lo puede otorgar. Es una falla del sistema.`,
			permiso: codigo,
		};
	}
	if (codigo) {
		return {
			causa: 'permiso',
			explicacion: `Le falta el permiso ${codigo} (${descripciones.descripcionPermiso(codigo)}).`,
			permiso: codigo,
		};
	}
	if (status === undefined || status === null || status === '') return { causa: null, explicacion: null, permiso: null };
	return { ...explicarStatus(status), permiso: null };
}

function quienHabilita(ctx) {
	const check = typeof ctx?.tienePermiso === 'function' ? ctx.tienePermiso : () => false;
	if (check(ctx?.permisos || [], 'CONFIGURACION.ROLES.EDITAR')) {
		return 'Vos mismo lo podés asignar en Configuración → Matriz de permisos.';
	}
	const rol = ctx?.req?.rolNombre ? ` (tu rol es ${ctx.req.rolNombre})` : '';
	return `Lo habilita un administrador de tu institución en Configuración → Matriz de permisos${rol}.`;
}

/**
 * @param {{ accion?: string, error?: string }} args
 * @param {object} ctx
 */
function diagnosticar(args, ctx) {
	const accion = String(args?.accion || '').trim();
	const check = typeof ctx?.tienePermiso === 'function' ? ctx.tienePermiso : () => false;
	const permisos = ctx?.permisos || [];

	const errores = (ctx?.pantalla?.errores || []).map((e) => ({ ...e, ...explicarError(e) }));
	if (String(args?.error || '').trim()) {
		errores.unshift({ origen: 'usuario', mensaje: String(args.error).slice(0, 300), ...explicarError({ mensaje: args.error }) });
	}

	const porError = errores.filter((e) => e.causa !== 'permiso_inexistente').map((e) => e.permiso).filter(Boolean);
	const vistos = new Set();
	const lista = [];
	for (const codigo of porError) {
		if (vistos.has(codigo)) continue;
		vistos.add(codigo);
		lista.push({ codigo, que: descripciones.descripcionPermiso(codigo), tiene: check(permisos, codigo), segun: 'error' });
	}
	for (const e of candidatos(accion)) {
		if (vistos.has(e.codigo)) continue;
		vistos.add(e.codigo);
		lista.push({
			codigo: e.codigo,
			que: e.que,
			pantalla: `${e.modLabel} → ${e.pantalla}`,
			path: e.path || undefined,
			tiene: check(permisos, e.codigo),
		});
	}

	// Un permiso nombrado por el error es la causa; si no, alcanza con tener alguno de los candidatos empatados.
	const delError = lista.filter((p) => p.segun === 'error');
	const ajeno = errores.some((e) => e.causa === 'registro_ajeno');
	let conclusion;
	if (ajeno) conclusion = 'registro_ajeno';
	else if (errores.some((e) => e.causa === 'permiso_inexistente')) conclusion = 'permiso_inexistente';
	else if (delError.some((p) => !p.tiene)) conclusion = 'falta_permiso';
	else if (errores[0]?.causa && errores[0].causa !== 'permiso') conclusion = errores[0].causa;
	else if (!lista.length) conclusion = 'sin_coincidencia';
	else if (!lista.some((p) => p.tiene)) conclusion = 'falta_permiso';
	else conclusion = 'tiene_los_permisos';

	const pasos = {
		falta_permiso: quienHabilita(ctx),
		registro_ajeno: 'No es un problema de permisos: pedile al profesional que lo cargó que lo corrija, o a un administrador clínico.',
		tiene_los_permisos:
			'Tiene los permisos. Si igual no le deja: puede ser un registro de otro profesional, una visita egresada o un dato obligatorio vacío; si «no aparece» o «se borró», casi siempre es el filtro de fecha/período («Hoy»). Buscá el artículo del manual o pedile el mensaje exacto del error.',
		permiso_inexistente:
			'No lo resuelve un administrador de la clínica: hay que avisar a soporte técnico de iMedic con la pantalla y el mensaje. Si existe, ofrecé el camino alternativo del manual.',
		sin_coincidencia: 'No reconocí la acción en la matriz de permisos: preguntale qué pantalla y qué botón usaba.',
	};

	return {
		accion,
		rol: ctx?.req?.rolNombre || null,
		conclusion,
		proximoPaso: pasos[conclusion] || errores[0]?.explicacion || null,
		permisos: lista,
		errores: errores.length ? errores.slice(0, 5) : undefined,
		alertas: ctx?.pantalla?.alertas?.length ? ctx.pantalla.alertas : undefined,
		deshabilitados: ctx?.pantalla?.deshabilitados?.length ? ctx.pantalla.deshabilitados : undefined,
		manual: articuloRelacionado(accion, ctx),
	};
}

/** Artículo con los problemas frecuentes de esa acción en esa pantalla (filtro de período, autoría…). */
function articuloRelacionado(accion, ctx) {
	if (!accion) return undefined;
	const hits = manual.buscar(accion, 1, { ruta: ctx?.pantalla?.url || ctx?.req?.body?.rutaActual });
	const [a] = manual.paraModelo(hits, 1800);
	return a?.problemas?.length ? { titulo: a.titulo, path: a.path, problemas: a.problemas } : undefined;
}

module.exports = { diagnosticar, candidatos, explicarError, explicarStatus };
