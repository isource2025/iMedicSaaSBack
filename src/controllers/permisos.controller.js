const permisosService = require('../services/permisos.service');
const personalPermisos = require('../services/personalPermisos.service');
const rolesService = require('../services/roles.service');
const matriz = require('../utils/permisos');
const { catalogoConDescripciones } = require('../utils/permisosDescripciones');
const { statusDeError } = require('../utils/httpError');

function idEmpresaDe(req) {
	const n = Number(req.idEmpresa ?? req.auth?.idEmpresa ?? req.auth?.empresa?.id);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** GET /api/permisos/me — devuelve rol(es) y permisos del usuario logueado. */
const obtenerMisPermisos = async (req, res) => {
	try {
		let rol = null;
		let roles = [];
		let permisos = [];
		try {
			const r = await permisosService.permisosDeUsuario(req.valorPersonal);
			rol = r.rol;
			roles = r.roles || [];
			permisos = r.permisos || [];
		} catch (e) {
			console.warn('[permisos.obtenerMisPermisos] permisosDeUsuario:', e.message);
		}
		// JWT del login (Railway) como fuente de verdad en producción
		const rn = req.rolNombre ? String(req.rolNombre).trim().toUpperCase() : '';
		const rolJwt = req.auth?.rol;
		if (!rol && rolJwt?.id != null) {
			rol = { id: Number(rolJwt.id), nombre: String(rolJwt.nombre || rn).toUpperCase() };
		}
		// ADMIN / SUPER_ADMIN: plantilla completa (no se aplican denies personales)
		if (rn === 'ADMIN') {
			permisos = [...matriz.permisosDeRol('ADMIN')];
			rol = { id: rol?.id ?? 1, nombre: 'ADMIN' };
			roles = [{ ...rol, esPrincipal: true }];
		} else if (rn === 'SUPER_ADMIN') {
			permisos = [...matriz.permisosDeRol('SUPER_ADMIN')];
			rol = { id: rol?.id ?? 5, nombre: 'SUPER_ADMIN' };
			roles = [{ ...rol, esPrincipal: true }];
		} else if (!permisos.length && rol?.id != null) {
			permisos = await permisosService.permisosDeRol(rol.id, rol.nombre);
		} else if (!permisos.length && rn) {
			permisos = matriz.permisosDeRol(rn);
		}
		if (!roles.length && rol) {
			roles = [{ ...rol, esPrincipal: true }];
		}
		res.json({ success: true, data: { rol, roles, permisos } });
	} catch (error) {
		console.error('[permisos.obtenerMisPermisos]', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: error.message || 'Error al obtener permisos' });
	}
};

/**
 * GET /api/permisos/personal/:valor
 * Base (unión de roles) + grants/denies + efectivos + catálogo para la UI de Personal.
 */
const obtenerDePersonal = async (req, res) => {
	try {
		const idEmpresa = idEmpresaDe(req);
		const valor = Number(req.params.valor);
		if (idEmpresa == null) {
			return res.status(400).json({ success: false, mensaje: 'Se requiere una empresa activa' });
		}
		if (!Number.isFinite(valor) || valor <= 0) {
			return res.status(400).json({ success: false, mensaje: 'Valor de personal inválido' });
		}
		const pack = await permisosService.permisosDeUsuario(valor);
		res.json({
			success: true,
			data: {
				rol: pack.rol,
				roles: pack.roles || [],
				base: pack.base || [],
				grants: pack.grants || [],
				denies: pack.denies || [],
				efectivos: pack.permisos || [],
				catalogo: catalogoConDescripciones(),
				permisosActor: Array.isArray(req.permisos) ? req.permisos : [],
			},
		});
	} catch (error) {
		console.error('[permisos.obtenerDePersonal]', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: error.message || 'Error al obtener permisos del personal',
		});
	}
};

/**
 * PUT /api/permisos/personal/:valor
 * Body: { efectivos: string[] } — se calculan GRANT/DENY respecto a la base actual de roles.
 */
const guardarDePersonal = async (req, res) => {
	try {
		const idEmpresa = idEmpresaDe(req);
		const valor = Number(req.params.valor);
		if (idEmpresa == null) {
			return res.status(400).json({ success: false, mensaje: 'Se requiere una empresa activa' });
		}
		if (!Number.isFinite(valor) || valor <= 0) {
			return res.status(400).json({ success: false, mensaje: 'Valor de personal inválido' });
		}
		const efectivos = Array.isArray(req.body?.efectivos) ? req.body.efectivos : null;
		if (!efectivos) {
			return res.status(400).json({ success: false, mensaje: 'Indicá la lista de permisos efectivos' });
		}

		const pack = await permisosService.permisosDeUsuario(valor);
		const base = pack.base || [];
		const guardado = await personalPermisos.guardarDesdeEfectivos({
			idEmpresa,
			valorPersonal: valor,
			base,
			efectivos,
			actor: {
				valorPersonal: req.valorPersonal,
				permisos: Array.isArray(req.permisos) ? req.permisos : [],
			},
		});

		res.json({
			success: true,
			mensaje:
				guardado.grants.length + guardado.denies.length === 0
					? 'Sin overrides: el personal queda con los permisos de sus roles'
					: `Permisos actualizados (+${guardado.grants.length} / −${guardado.denies.length})`,
			data: {
				base,
				grants: guardado.grants,
				denies: guardado.denies,
				efectivos: guardado.efectivos,
			},
		});
	} catch (error) {
		console.error('[permisos.guardarDePersonal]', error);
		const status = error.statusCode || statusDeError(error);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al guardar permisos del personal',
		});
	}
};

/**
 * POST /api/permisos/personal/preview
 * Body: { idRoles: number[] } — unión de plantillas sin guardar (para la UI al marcar roles).
 */
const previewBase = async (req, res) => {
	try {
		const ids = [
			...new Set(
				(Array.isArray(req.body?.idRoles) ? req.body.idRoles : [])
					.map((x) => Number(x))
					.filter((n) => Number.isFinite(n) && n > 0),
			),
		];
		const mapped = [];
		for (const id of ids) {
			const rol = await rolesService.obtenerRolPorId(id);
			if (rol) mapped.push({ idRol: rol.IdRol, nombre: rol.Nombre });
		}
		const base = await permisosService.baseDeRoles(mapped);
		res.json({ success: true, data: { base, roles: mapped } });
	} catch (error) {
		console.error('[permisos.previewBase]', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: error.message || 'Error al calcular la base de permisos',
		});
	}
};

/** GET /api/permisos/catalogo — devuelve la estructura MODULOS (para el panel admin). */
const obtenerCatalogo = (_req, res) => {
	try {
		res.json({
			success: true,
			data: {
				modulos: matriz.MODULOS,
				acciones: matriz.ACCIONES,
			},
		});
	} catch (error) {
		console.error('[permisos.obtenerCatalogo]', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: 'Error al obtener catálogo de permisos' });
	}
};

/** GET /api/permisos/rol/:idRol — permisos asignados a un rol. */
const obtenerPorRol = async (req, res) => {
	try {
		const idRol = Number(req.params.idRol);
		if (!Number.isFinite(idRol)) {
			return res.status(400).json({ success: false, mensaje: 'idRol inválido' });
		}
		const permisos = await permisosService.permisosDeRol(idRol);
		res.json({ success: true, data: { idRol, permisos } });
	} catch (error) {
		console.error('[permisos.obtenerPorRol]', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: 'Error al obtener permisos del rol' });
	}
};

module.exports = {
	obtenerMisPermisos,
	obtenerCatalogo,
	obtenerPorRol,
	obtenerDePersonal,
	guardarDePersonal,
	previewBase,
};
