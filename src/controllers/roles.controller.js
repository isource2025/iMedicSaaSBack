const rolesService = require('../services/roles.service');

const listar = async (req, res) => {
	try {
		const data = await rolesService.listarRoles();
		res.json({ success: true, data });
	} catch (error) {
		console.error('[roles.listar]', error);
		res.status(500).json({ success: false, mensaje: error.message || 'Error al listar roles' });
	}
};

const obtenerPorId = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'Id inválido' });
		}
		const data = await rolesService.obtenerRolPorId(id);
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Rol no encontrado' });
		}
		res.json({ success: true, data });
	} catch (error) {
		console.error('[roles.obtenerPorId]', error);
		res.status(500).json({ success: false, mensaje: error.message || 'Error al obtener rol' });
	}
};

/** PUT /api/roles/personal/:valor — body: { idRol: number|null } */
const asignarAPersonal = async (req, res) => {
	try {
		const valor = Number(req.params.valor);
		if (!Number.isFinite(valor)) {
			return res.status(400).json({ success: false, mensaje: 'Valor de personal inválido' });
		}
		const idRolRaw = req.body?.idRol;
		const idRol =
			idRolRaw == null || idRolRaw === '' ? null : Number(idRolRaw);
		const rol = await rolesService.asignarRolAPersonal(valor, idRol);
		res.json({
			success: true,
			mensaje: rol ? `Rol "${rol.Nombre}" asignado` : 'Rol eliminado',
			data: rol,
		});
	} catch (error) {
		console.error('[roles.asignarAPersonal]', error);
		const status = error.statusCode || 500;
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al asignar rol',
		});
	}
};

/** GET /api/roles/personal/:valor — devuelve el rol actual de un personal */
const obtenerDePersonal = async (req, res) => {
	try {
		const valor = Number(req.params.valor);
		if (!Number.isFinite(valor)) {
			return res.status(400).json({ success: false, mensaje: 'Valor de personal inválido' });
		}
		const data = await rolesService.obtenerRolDePersonal(valor);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[roles.obtenerDePersonal]', error);
		const msg = String(error?.message || '').toLowerCase();
		if (msg.includes("invalid object name 'imroles'")) {
			return res.json({ success: true, data: null });
		}
		res.status(500).json({ success: false, mensaje: error.message || 'Error al obtener rol' });
	}
};

module.exports = {
	listar,
	obtenerPorId,
	asignarAPersonal,
	obtenerDePersonal,
};
