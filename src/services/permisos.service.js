/**
 * Servicio de Permisos.
 *
 * - Lectura desde BD (`imPermisos`, `imRolPermisos`).
 * - Caché en memoria por rol (TTL = 5 min) para no consultar en cada request.
 * - API alineada con `utils/permisos.js` (mismas funciones disponibles).
 *
 * Si la BD no tiene permisos sembrados, el servicio cae a la matriz hardcoded
 * en `utils/permisos.js` para no romper sesiones existentes.
 */
const { executeQuery } = require('../models/db');
const matriz = require('../utils/permisos');
const authCentralService = require('./authCentral.service');

const TTL_MS = 5 * 60 * 1000; // 5 minutos
const _cache = new Map(); // idRol -> { permisos: string[], expira: number }

function _ahora() { return Date.now(); }

async function _leerDeBD(idRol) {
	if (authCentralService.isAuthCentralEnabled()) {
		try {
			const permisosCentral = await authCentralService.permisosDeRol(idRol);
			if (permisosCentral.length) return permisosCentral;
		} catch (e) {
			console.warn('[authCentral] permisosDeRol:', e.message);
		}
	}

	const rows = await executeQuery(
		`
    SELECT p.Codigo
    FROM dbo.imRolPermisos rp
    INNER JOIN dbo.imPermisos p ON p.IdPermiso = rp.IdPermiso
    WHERE rp.IdRol = @p0
    `,
		[{ value: Number(idRol), type: 'Int' }],
	);
	return rows.map((r) => String(r.Codigo || '')).filter(Boolean);
}

/**
 * Permisos efectivos de un rol (por id).
 *
 * @param {number|null|undefined} idRol
 * @param {string} [nombreRol] usado como fallback para la matriz hardcoded.
 * @returns {Promise<string[]>}
 */
async function permisosDeRol(idRol, nombreRol) {
	// ADMIN siempre con matriz completa (misma capacidad operativa que en plantilla;
	// evita que un imRolPermisos incompleto en BD deje sin gestión de médicos/agenda).
	const nombre = nombreRol ? String(nombreRol).trim().toUpperCase() : '';
	if (nombre === 'ADMIN') {
		return [...matriz.permisosDeRol('ADMIN')];
	}
	if (nombre === 'SUPER_ADMIN') {
		return [...matriz.permisosDeRol('SUPER_ADMIN')];
	}
	if (idRol == null || !Number.isFinite(Number(idRol))) {
		return matriz.permisosDeRol(nombreRol || null);
	}
	const id = Number(idRol);

	const hit = _cache.get(id);
	if (hit && hit.expira > _ahora()) return [...hit.permisos];

	let permisos = [];
	try {
		permisos = await _leerDeBD(id);
	} catch (e) {
		console.warn('[permisos.service] Falla leyendo BD, uso matriz hardcoded:', e.message);
	}

	// Fallback si la BD aún no está sembrada
	if (!permisos.length && nombreRol) {
		permisos = matriz.permisosDeRol(nombreRol);
	}

	_cache.set(id, { permisos, expira: _ahora() + TTL_MS });
	return [...permisos];
}

/** Permisos efectivos del usuario logueado (por valorPersonal). */
async function permisosDeUsuario(valorPersonal) {
	if (!Number.isFinite(Number(valorPersonal))) return [];
	const rows = await executeQuery(
		`
    SELECT TOP 1
      r.IdRol,
      LTRIM(RTRIM(r.Nombre)) AS Nombre
    FROM dbo.imPersonal p
    LEFT JOIN dbo.imRoles r
      ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
    WHERE p.Valor = @p0
    `,
		[{ value: Number(valorPersonal), type: 'Int' }],
	);
	const r = rows[0];
	if (!r || r.IdRol == null) {
		// Sin rol asignado → sin permisos.
		return { rol: null, permisos: [] };
	}
	const permisos = await permisosDeRol(Number(r.IdRol), r.Nombre);
	return {
		rol: { id: Number(r.IdRol), nombre: String(r.Nombre || '').toUpperCase() },
		permisos,
	};
}

/** Invalida la caché para un rol (o toda si no se pasa argumento). */
function invalidarCache(idRol) {
	if (idRol == null) {
		_cache.clear();
		return;
	}
	_cache.delete(Number(idRol));
}

/** ¿Tiene el rol el permiso indicado? Acepta verificación parcial. */
function tienePermiso(permisos, codigo) {
	if (!codigo) return false;
	const c = String(codigo);
	if (!Array.isArray(permisos)) return false;
	if (permisos.includes(c)) return true;
	const dots = (c.match(/\./g) || []).length;
	if (dots < 2) {
		const prefijo = c + '.';
		return permisos.some((p) => p.startsWith(prefijo));
	}
	return false;
}

module.exports = {
	permisosDeRol,
	permisosDeUsuario,
	invalidarCache,
	tienePermiso,
};
