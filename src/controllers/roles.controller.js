const rolesService = require('../services/roles.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const listar = async (req, res) => {
	try {
		const data = await rolesService.listarRoles();
		res.json({ success: true, data });
	} catch (error) {
		console.error('[roles.listar]', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: error.message || 'Error al listar roles' });
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
		res.status(statusDeError(error)).json({ success: false, mensaje: error.message || 'Error al obtener rol' });
	}
};

/**
 * PUT /api/roles/personal/:valor
 * Body multi: { idRoles: number[], idRolPrincipal?: number|null }
 * Body legacy: { idRol: number|null }
 */
const asignarAPersonal = async (req, res) => {
	try {
		const valor = Number(req.params.valor);
		if (!Number.isFinite(valor)) {
			return res.status(400).json({ success: false, mensaje: 'Valor de personal inválido' });
		}

		const body = req.body || {};
		let result;

		if (Array.isArray(body.idRoles)) {
			const idRolPrincipal =
				body.idRolPrincipal == null || body.idRolPrincipal === ''
					? null
					: Number(body.idRolPrincipal);
			result = await rolesService.asignarRolesAPersonal(valor, body.idRoles, idRolPrincipal);
		} else {
			const idRolRaw = body.idRol;
			const idRol = idRolRaw == null || idRolRaw === '' ? null : Number(idRolRaw);
			const principal = await rolesService.asignarRolAPersonal(valor, idRol);
			result = {
				roles: principal ? [{ ...principal, EsPrincipal: true }] : [],
				principal,
			};
		}

		const n = result.roles.length;
		res.json({
			success: true,
			mensaje:
				n === 0
					? 'Roles eliminados'
					: n === 1
						? `Rol "${result.principal?.Nombre || ''}" asignado`
						: `${n} roles asignados`,
			data: result,
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

/** GET /api/roles/personal/:valor — roles asignados + principal */
const obtenerDePersonal = async (req, res) => {
	try {
		const valor = Number(req.params.valor);
		if (!Number.isFinite(valor)) {
			return res.status(400).json({ success: false, mensaje: 'Valor de personal inválido' });
		}
		const data = await rolesService.obtenerRolesDePersonal(valor);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[roles.obtenerDePersonal]', error);
		const msg = String(error?.message || '').toLowerCase();
		if (msg.includes("invalid object name 'imroles'")) {
			return res.json({ success: true, data: { roles: [], principal: null } });
		}
		res.status(statusDeError(error)).json({ success: false, mensaje: error.message || 'Error al obtener rol' });
	}
};

module.exports = {
	listar,
	obtenerPorId,
	asignarAPersonal,
	obtenerDePersonal,
};
