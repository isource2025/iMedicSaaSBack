const servicio = require('../services/catalogoSql.service');
const permisosService = require('../services/permisos.service');
const { statusDeError } = require('../utils/httpError');

function fallar(res, error, mensaje) {
	res.status(error?.statusCode || statusDeError(error)).json({
		success: false,
		message: error?.message || mensaje,
	});
}

function exigirPermisoDelCatalogo(req, res) {
	const def = servicio.porId(req.params.id);
	if (!permisosService.tienePermiso(req.permisos || [], def.permiso)) {
		res.status(403).json({ success: false, message: `Permiso requerido: ${def.permiso}` });
		return null;
	}
	return def;
}

async function responder(res, resultado) {
	res.json({
		success: true,
		data: resultado.rows,
		columns: await servicio.columnasUi(resultado.def),
		keyField: servicio.keyFieldDe(resultado.def),
		title: resultado.def.title,
		id: resultado.def.id,
	});
}

async function listar(req, res) {
	try {
		if (!exigirPermisoDelCatalogo(req, res)) return;
		await responder(res, await servicio.listar(req.params.id));
	} catch (error) {
		fallar(res, error, 'Error al listar el catálogo');
	}
}

async function crear(req, res) {
	try {
		if (!exigirPermisoDelCatalogo(req, res)) return;
		await responder(res, await servicio.crear(req.params.id, req.body || {}));
	} catch (error) {
		fallar(res, error, 'Error al crear el registro');
	}
}

async function actualizar(req, res) {
	try {
		if (!exigirPermisoDelCatalogo(req, res)) return;
		await responder(res, await servicio.actualizar(req.params.id, req.params.clave, req.body || {}));
	} catch (error) {
		fallar(res, error, 'Error al actualizar el registro');
	}
}

async function borrar(req, res) {
	try {
		if (!exigirPermisoDelCatalogo(req, res)) return;
		await responder(res, await servicio.borrar(req.params.id, req.params.clave));
	} catch (error) {
		fallar(res, error, 'Error al eliminar el registro');
	}
}

async function buscar(req, res) {
	try {
		if (!exigirPermisoDelCatalogo(req, res)) return;
		const data = await servicio.buscar(req.params.id, req.params.campo, req.query.q);
		res.json({ success: true, data });
	} catch (error) {
		fallar(res, error, 'Error al buscar');
	}
}

module.exports = { listar, crear, actualizar, borrar, buscar };
