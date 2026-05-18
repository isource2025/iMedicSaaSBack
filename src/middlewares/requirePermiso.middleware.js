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

function requirePermiso(codigo) {
	if (!codigo || typeof codigo !== 'string') {
		throw new Error('requirePermiso: se requiere código de permiso');
	}
	return async function (req, res, next) {
		try {
			if (!req.auth) {
				return res.status(401).json({ success: false, mensaje: 'No autorizado' });
			}

			let permisos = [];
			try {
				const r = await permisosService.permisosDeUsuario(req.valorPersonal);
				permisos = Array.isArray(r) ? r : r?.permisos || [];
			} catch (e) {
				console.warn('[requirePermiso] permisosDeUsuario falló:', e.message);
			}

			// Fallback a matriz hardcoded por rol (JWT) si BD no respondió
			if (!permisos.length && req.rolNombre) {
				permisos = matriz.permisosDeRol(req.rolNombre);
			}
			// ADMIN: siempre matriz completa (garantiza gestión tipo administrativo)
			const rn = req.rolNombre ? String(req.rolNombre).trim().toUpperCase() : '';
			if (rn === 'ADMIN') {
				permisos = matriz.permisosDeRol('ADMIN');
			}

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

module.exports = { requirePermiso };
