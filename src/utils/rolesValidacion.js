/**
 * Validaciones puras (sin base de datos) para roles personalizados.
 */
const { MODULOS } = require('./permisos');
const { esPermisoRestringido } = require('./permisosDescripciones');

/** IdRol desde el cual se numeran los roles personalizados (1..999 = sistema). */
const ID_ROL_PERSONALIZADO_MIN = 1000;

/** Valores permitidos de RolBase: qué comportamiento heredan del rol estándar. */
const ROLES_BASE = Object.freeze(['NINGUNO', 'MEDICO', 'ENFERMERO', 'ADMINISTRATIVO', 'CARGA_HC']);

/**
 * Nombres (en forma compacta, sólo letras) que no puede usar un rol
 * personalizado: los roles del sistema y sus etiquetas visibles.
 */
const NOMBRES_RESERVADOS = Object.freeze(
	[
		'ADMIN',
		'SUPERADMIN',
		'SUPERADMINISTRADOR',
		'MEDICO',
		'ENFERMERO',
		'ENFERMERA',
		'ENFERMERIA',
		'ADMINISTRATIVO',
		'CARGAHC',
		'CARGADEADJUNTOS',
		'PANELDATOS',
		'PANELDEDATOS',
		'PLATAFORMA',
		'SISTEMA',
	].map((n) => n),
);

/** Forma compacta: sin acentos, mayúsculas, sólo A-Z y 0-9. */
function claveNombre(nombre) {
	return String(nombre || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
}

function normalizarNombre(nombre) {
	return String(nombre || '').replace(/\s+/g, ' ').trim();
}

/** @returns {{ ok: boolean, nombre?: string, error?: string }} */
function validarNombre(nombreCrudo) {
	const nombre = normalizarNombre(nombreCrudo);
	if (nombre.length < 3) return { ok: false, error: 'El nombre debe tener al menos 3 caracteres' };
	if (nombre.length > 50) return { ok: false, error: 'El nombre no puede superar los 50 caracteres' };
	if (!/^[\p{L}\p{N} _.\-/()+]+$/u.test(nombre)) {
		return { ok: false, error: 'El nombre solo puede tener letras, números, espacios y . - _ / ( ) +' };
	}
	if (NOMBRES_RESERVADOS.includes(claveNombre(nombre))) {
		return { ok: false, error: `El nombre "${nombre}" está reservado por el sistema` };
	}
	return { ok: true, nombre };
}

function validarDescripcion(descripcion) {
	const d = normalizarNombre(descripcion);
	if (d.length > 200) return { ok: false, error: 'La descripción no puede superar los 200 caracteres' };
	return { ok: true, descripcion: d };
}

function validarRolBase(rolBase) {
	const b = String(rolBase || 'NINGUNO').trim().toUpperCase();
	if (!ROLES_BASE.includes(b)) {
		return { ok: false, error: `Rol base inválido (permitidos: ${ROLES_BASE.join(', ')})` };
	}
	return { ok: true, rolBase: b };
}

// ─── Permisos ───────────────────────────────────────────────────────────────

/** Orden canónico y mapa código → { modulo, submodulo, accion } del catálogo. */
function indiceCatalogo() {
	const orden = [];
	const info = new Map();
	const tieneVer = new Set(); // 'MOD.SUB' con acción VER
	for (const m of MODULOS) {
		for (const s of m.submodulos) {
			for (const a of s.acciones) {
				const codigo = `${m.id}.${s.id}.${a}`;
				orden.push(codigo);
				info.set(codigo, { modulo: m.id, submodulo: s.id, accion: a });
				if (a === 'VER') tieneVer.add(`${m.id}.${s.id}`);
			}
		}
	}
	return { orden, info, tieneVer };
}

/**
 * Valida y normaliza el conjunto de permisos de un rol personalizado.
 *
 * Reglas:
 *  - todo código debe existir en el catálogo;
 *  - no se admiten permisos restringidos (PLATAFORMA.*, CONFIGURACION.ROLES.*);
 *  - el actor sólo puede otorgar permisos que él mismo tiene;
 *  - si un submódulo tiene VER y se marca otra acción, se agrega VER.
 *
 * @param {string[]} codigos
 * @param {{ permisosActor?: Iterable<string>|null }} [opciones]
 *   permisosActor: null/undefined = no se comprueba (uso interno).
 * @returns {{ ok: boolean, permisos: string[], agregados: string[], errores: string[] }}
 */
function normalizarPermisos(codigos, { permisosActor = null } = {}) {
	const { orden, info, tieneVer } = indiceCatalogo();
	const actor = permisosActor ? new Set(permisosActor) : null;
	const errores = [];
	const elegidos = new Set();

	if (!Array.isArray(codigos)) {
		return { ok: false, permisos: [], agregados: [], errores: ['El listado de permisos es inválido'] };
	}

	for (const crudo of codigos) {
		const c = String(crudo || '').trim();
		if (!c) continue;
		if (!info.has(c)) {
			errores.push(`Permiso desconocido: ${c}`);
		} else if (esPermisoRestringido(c)) {
			errores.push(`El permiso ${c} no se puede asignar a un rol personalizado`);
		} else {
			elegidos.add(c);
		}
	}

	// VER implícito
	const agregados = [];
	for (const c of [...elegidos]) {
		const { modulo, submodulo, accion } = info.get(c);
		const base = `${modulo}.${submodulo}`;
		if (accion !== 'VER' && tieneVer.has(base) && !elegidos.has(`${base}.VER`)) {
			elegidos.add(`${base}.VER`);
			agregados.push(`${base}.VER`);
		}
	}

	// El actor sólo otorga lo que tiene
	if (actor) {
		for (const c of elegidos) {
			if (!actor.has(c)) errores.push(`No podés otorgar el permiso ${c} porque no lo tenés`);
		}
	}

	const permisos = orden.filter((c) => elegidos.has(c));
	return { ok: errores.length === 0, permisos, agregados, errores };
}

module.exports = {
	ID_ROL_PERSONALIZADO_MIN,
	ROLES_BASE,
	NOMBRES_RESERVADOS,
	claveNombre,
	normalizarNombre,
	validarNombre,
	validarDescripcion,
	validarRolBase,
	normalizarPermisos,
};
