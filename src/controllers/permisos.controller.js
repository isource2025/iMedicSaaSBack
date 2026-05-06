const permisosService = require('../services/permisos.service');
const matriz = require('../utils/permisos');

/** GET /api/permisos/me — devuelve rol y permisos del usuario logueado. */
const obtenerMisPermisos = async (req, res) => {
	try {
		const { rol, permisos } = await permisosService.permisosDeUsuario(req.valorPersonal);
		res.json({ success: true, data: { rol, permisos } });
	} catch (error) {
		console.error('[permisos.obtenerMisPermisos]', error);
		res.status(500).json({ success: false, mensaje: error.message || 'Error al obtener permisos' });
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
		res.status(500).json({ success: false, mensaje: 'Error al obtener catálogo de permisos' });
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
		res.status(500).json({ success: false, mensaje: 'Error al obtener permisos del rol' });
	}
};

module.exports = {
	obtenerMisPermisos,
	obtenerCatalogo,
	obtenerPorRol,
};
