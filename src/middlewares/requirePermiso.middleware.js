/**
 * Middleware factory: exige que el usuario autenticado tenga un permiso
 * específico (código tipo 'MODULO.SUBMODULO.ACCION', con verificación parcial).
 *
 * Debe usarse SIEMPRE después de `requireAuth`.
 *
 * Resolución de permisos (unión multi-rol):
 *   1) `permisos.service.permisosDeUsuario` — une las plantillas de TODOS los
 *      roles del personal (p. ej. MEDICO + PANEL_DATOS).
 *   2) Si eso falla o viene vacío, cae a la plantilla del rol principal del JWT.
 */
const permisosService = require('../services/permisos.service');
const matriz = require('../utils/permisos');

const ROLES_MATRIZ = new Set([
	'ADMIN',
	'SUPER_ADMIN',
	'MEDICO',
	'ADMINISTRATIVO',
	'ENFERMERO',
	'CARGA_HC',
	'PANEL_DATOS',
]);

async function _resolverPermisosReq(req) {
	try {
		const r = await permisosService.permisosDeUsuario(req.valorPersonal);
		const permisos = Array.isArray(r) ? r : r?.permisos || [];
		if (permisos.length) return permisos;
	} catch (e) {
		console.warn('[requirePermiso] permisosDeUsuario falló:', e.message);
	}

	const rn = req.rolNombre ? String(req.rolNombre).trim().toUpperCase() : '';
	if (ROLES_MATRIZ.has(rn)) {
		return matriz.permisosDeRol(rn);
	}
	if (rn) {
		return matriz.permisosDeRol(rn);
	}
	return [];
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
