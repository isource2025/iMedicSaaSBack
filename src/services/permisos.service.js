/**
 * Servicio de Permisos.
 *
 * - Lectura desde BD (`imPermisos`, `imRolPermisos`).
 * - Caché en memoria por rol (TTL = 5 min) para no consultar en cada request.
 * - API alineada con `utils/permisos.js` (mismas funciones disponibles).
 *
 * En producción (auth central / Railway) el catálogo de roles y permisos es
 * global en MySQL; no se consulta imRoles en el SQL físico del tenant.
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const matriz = require('../utils/permisos');
const authCentralService = require('./authCentral.service');

const TTL_MS = 5 * 60 * 1000; // 5 minutos
const _cache = new Map(); // idRol -> { permisos: string[], expira: number }

function _ahora() { return Date.now(); }

function esErrorEsquemaRoles(error) {
	const msg = String(error?.message || '').toLowerCase();
	return (
		msg.includes("invalid object name 'imroles'") ||
		msg.includes("invalid object name 'imrolpermisos'") ||
		msg.includes("invalid object name 'impermisos'") ||
		msg.includes("invalid column name 'rol'")
	);
}

async function _leerDeBD(idRol) {
	if (authCentralService.isAuthCentralEnabled()) {
		try {
			return await authCentralService.permisosDeRol(idRol);
		} catch (e) {
			console.warn('[authCentral] permisosDeRol:', e.message);
			return [];
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

function esErrorConexionTenant(error) {
	const msg = String(error?.message || '').toLowerCase();
	return (
		error?.code === 'ETIMEOUT' ||
		error?.originalError?.code === 'ETIMEOUT' ||
		msg.includes('etimeout') ||
		msg.includes('failed to connect') ||
		msg.includes('econnrefused') ||
		msg.includes('etimedout')
	);
}

/** Permisos efectivos del usuario logueado (por valorPersonal + empresa del JWT). */
async function permisosDeUsuario(valorPersonal) {
	if (!Number.isFinite(Number(valorPersonal))) {
		return { rol: null, permisos: [] };
	}
	const vp = Number(valorPersonal);
	const idEmpresa = getTenantId();

	if (authCentralService.isAuthCentralEnabled()) {
		if (idEmpresa == null || !Number.isFinite(Number(idEmpresa)) || Number(idEmpresa) <= 0) {
			return { rol: null, permisos: [] };
		}
		try {
			const mapped = await authCentralService.obtenerRolDeValorPersonal(Number(idEmpresa), vp);
			if (mapped) {
				const permisos = await permisosDeRol(mapped.idRol, mapped.nombre);
				return {
					rol: { id: mapped.idRol, nombre: String(mapped.nombre || '').toUpperCase() },
					permisos,
				};
			}
		} catch (e) {
			if (!esErrorEsquemaRoles(e) && !esErrorConexionTenant(e)) {
				console.warn('[permisos] auth central permisosDeUsuario:', e.message);
			}
		}
		return { rol: null, permisos: [] };
	}

	try {
		const rows = await executeQuery(
			`
    SELECT TOP 1
      LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS RolId,
      COALESCE(pw.Grupo, 0) AS Grupo
    FROM dbo.imPersonal p
    LEFT JOIN dbo.imPassword pw ON pw.ValorPersonal = p.Valor
    WHERE p.Valor = @p0
    `,
			[{ value: vp, type: 'Int' }],
		);
		const r = rows[0];
		if (!r) return { rol: null, permisos: [] };
		const rolIdRaw = r.RolId != null && r.RolId !== '' ? Number(r.RolId) : null;
		const rolId = Number.isFinite(rolIdRaw) && rolIdRaw > 0 ? rolIdRaw : null;
		if (!rolId && Number(r.Grupo) !== 11) return { rol: null, permisos: [] };
		const idRol = Number(r.Grupo) === 11 ? 1 : rolId;
		const nombre = Number(r.Grupo) === 11 ? 'ADMIN' : null;
		const permisos = await permisosDeRol(idRol, nombre);
		return {
			rol: { id: idRol, nombre: String(nombre || '').toUpperCase() },
			permisos,
		};
	} catch (e) {
		if (esErrorEsquemaRoles(e) || esErrorConexionTenant(e)) {
			return { rol: null, permisos: [] };
		}
		throw e;
	}
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
