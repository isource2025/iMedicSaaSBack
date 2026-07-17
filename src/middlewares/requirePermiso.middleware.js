/**
 * Middleware factory: exige que el usuario autenticado tenga un permiso
 * específico (código tipo 'MODULO.SUBMODULO.ACCION', con verificación parcial).
 *
 * Debe usarse SIEMPRE después de `requireAuth`.
 *
 * Resolución de permisos:
 *   1) Lee permisos efectivos desde `permisos.service.permisosDeUsuario(valorPersonal)`
 *      (que consulta `imPersonal.Rol` → `imRolPermisos` y cachea por rol).
 *   2) Si la BD no devuelve permisos (sin sembrar), cae a la matriz hardcoded
 *      en `utils/permisos.js` usando el rol del JWT.
 */
const permisosService = require('../services/permisos.service');
const matriz = require('../utils/permisos');

async function _resolverPermisosReq(req) {
	let permisos = [];
	try {
		const r = await permisosService.permisosDeUsuario(req.valorPersonal);
		permisos = Array.isArray(r) ? r : r?.permisos || [];
	} catch (e) {
		console.warn('[requirePermiso] permisosDeUsuario falló:', e.message);
	}

	if (!permisos.length && req.rolNombre) {
		permisos = matriz.permisosDeRol(req.rolNombre);
	}
	const rn = req.rolNombre ? String(req.rolNombre).trim().toUpperCase() : '';
	if (rn === 'ADMIN') {
		permisos = matriz.permisosDeRol('ADMIN');
	}
	if (rn === 'SUPER_ADMIN') {
		permisos = matriz.permisosDeRol('SUPER_ADMIN');
	}
	return permisos;
}

function requirePermiso(codigo) {
	if (!codigo || typeof codigo !== 'string') {
		throw new Error('requirePermiso: se requiere código de permiso');
	}
	return async function (req, res, next) {
		try {
			if (!req.auth) {
				return res.status(401).json({ success: false, mensaje: 'No autorizado' });
			}

			const permisos = await _resolverPermisosReq(req);

			if (permisosService.tienePermiso(permisos, codigo)) {
				req.permisos = permisos;
				return next();
			}
			return res
				.status(403)
				.json({ success: false, mensaje: `Permiso requerido: ${codigo}` });
		} catch (e) {
			console.error('[requirePermiso] error:', e.message);
			return res.status(500).json({ success: false, mensaje: 'Error verificando permisos' });
		}
	};
}

/** Pasa si el usuario tiene al menos uno de los códigos. */
function requireAnyPermiso(...codigos) {
	const lista = codigos.filter((c) => typeof c === 'string' && c);
	if (!lista.length) {
		throw new Error('requireAnyPermiso: se requiere al menos un código');
	}
	return async function (req, res, next) {
		try {
			if (!req.auth) {
				return res.status(401).json({ success: false, mensaje: 'No autorizado' });
			}
			const permisos = await _resolverPermisosReq(req);
			const ok = lista.some((c) => permisosService.tienePermiso(permisos, c));
			if (ok) {
				req.permisos = permisos;
				return next();
			}
			return res.status(403).json({
				success: false,
				mensaje: `Permiso requerido: ${lista.join(' o ')}`,
			});
		} catch (e) {
			console.error('[requireAnyPermiso] error:', e.message);
			return res.status(500).json({ success: false, mensaje: 'Error verificando permisos' });
		}
	};
}

module.exports = { requirePermiso, requireAnyPermiso };
