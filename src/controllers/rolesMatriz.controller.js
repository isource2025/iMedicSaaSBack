/**
 * Matriz de permisos: administración de roles personalizados de la clínica.
 * Los 7 roles del sistema son de sólo lectura (se pueden duplicar).
 */
const rolesCustom = require('../services/rolesCustom.service');
const { catalogoConDescripciones } = require('../utils/permisosDescripciones');

function idEmpresaDe(req) {
	const n = Number(req.idEmpresa ?? req.auth?.idEmpresa ?? req.auth?.empresa?.id);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function actorDe(req) {
	return { valorPersonal: req.valorPersonal, permisos: Array.isArray(req.permisos) ? req.permisos : [] };
}

function idParam(req) {
	const n = Number(req.params.id);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function responderError(res, tag, error) {
	const status = Number(error?.statusCode) || 500;
	if (status >= 500) console.error(`[rolesMatriz.${tag}]`, error);
	res.status(status).json({
		success: false,
		mensaje: status >= 500 && !error?.statusCode ? 'Error interno al procesar roles' : error.message,
	});
}

/** Envuelve un handler: valida empresa y unifica el manejo de errores. */
function handler(tag, fn) {
	return async (req, res) => {
		try {
			const idEmpresa = idEmpresaDe(req);
			if (idEmpresa == null) {
				return res.status(400).json({ success: false, mensaje: 'Se requiere una empresa activa' });
			}
			const data = await fn(req, idEmpresa);
			res.json({ success: true, ...(data?.mensaje ? { mensaje: data.mensaje } : {}), data: data?.data ?? data });
		} catch (error) {
			responderError(res, tag, error);
		}
	};
}

/** GET /api/roles/matriz — roles + catálogo con descripciones, en una sola llamada. */
const matriz = handler('matriz', async (req, idEmpresa) => {
	const roles = await rolesCustom.listarMatriz(idEmpresa);
	return {
		data: {
			...roles,
			catalogo: catalogoConDescripciones(),
			permisosActor: Array.isArray(req.permisos) ? req.permisos : [],
		},
	};
});

/** POST /api/roles */
const crear = handler('crear', async (req, idEmpresa) => {
	const b = req.body || {};
	const rol = await rolesCustom.crearRol({
		idEmpresa,
		actor: actorDe(req),
		nombre: b.nombre,
		descripcion: b.descripcion,
		rolBase: b.rolBase,
		permisos: b.permisos,
	});
	return { mensaje: `Rol "${rol.nombre}" creado`, data: rol };
});

/** PUT /api/roles/:id */
const actualizar = handler('actualizar', async (req, idEmpresa) => {
	const id = idParam(req);
	if (id == null) throw Object.assign(new Error('Id de rol inválido'), { statusCode: 400 });
	const b = req.body || {};
	const rol = await rolesCustom.actualizarRol(id, {
		idEmpresa,
		actor: actorDe(req),
		nombre: b.nombre,
		descripcion: b.descripcion,
		rolBase: b.rolBase,
		permisos: b.permisos,
	});
	return { mensaje: 'Rol actualizado', data: rol };
});

/** POST /api/roles/:id/duplicar */
const duplicar = handler('duplicar', async (req, idEmpresa) => {
	const id = idParam(req);
	if (id == null) throw Object.assign(new Error('Id de rol inválido'), { statusCode: 400 });
	const b = req.body || {};
	const rol = await rolesCustom.duplicarRol(id, {
		idEmpresa,
		actor: actorDe(req),
		nombre: b.nombre,
		descripcion: b.descripcion,
	});
	return { mensaje: `Rol "${rol.nombre}" creado`, data: rol };
});

/** DELETE /api/roles/:id */
const eliminar = handler('eliminar', async (req, idEmpresa) => {
	const id = idParam(req);
	if (id == null) throw Object.assign(new Error('Id de rol inválido'), { statusCode: 400 });
	await rolesCustom.eliminarRol(id, { idEmpresa, actor: actorDe(req) });
	return { mensaje: 'Rol eliminado', data: { idRol: id } };
});

/** GET /api/roles/:id/usuarios */
const usuarios = handler('usuarios', async (req, idEmpresa) => {
	const id = idParam(req);
	if (id == null) throw Object.assign(new Error('Id de rol inválido'), { statusCode: 400 });
	return { data: await rolesCustom.usuariosDeRol(id, idEmpresa) };
});

/** GET /api/roles/:id/auditoria */
const auditoria = handler('auditoria', async (req, idEmpresa) => {
	const id = idParam(req);
	if (id == null) throw Object.assign(new Error('Id de rol inválido'), { statusCode: 400 });
	return { data: await rolesCustom.auditoriaDeRol(id, idEmpresa) };
});

module.exports = { matriz, crear, actualizar, duplicar, eliminar, usuarios, auditoria };
