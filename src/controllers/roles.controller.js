const rolesService = require('../services/roles.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');
const { esAdminClinico } = require('../middlewares/propietario.middleware');

const ID_ROL_ADMIN = 1;
const ID_ROL_SUPER_ADMIN = 5;
const rolesCustom = () => require('../services/rolesCustom.service');

function esSuperAdminReq(req) {
	return (
		Number(req.auth?.rol?.id) === ID_ROL_SUPER_ADMIN ||
		String(req.rolNombre || '').toUpperCase() === 'SUPER_ADMIN'
	);
}

/** Ids de rol pedidos en el body (formato nuevo `idRoles` o legacy `idRol`). */
function idsPedidos(body) {
	const crudo = Array.isArray(body?.idRoles)
		? [...body.idRoles, body.idRolPrincipal]
		: [body?.idRol];
	return new Set(
		crudo.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0),
	);
}

/**
 * Protege contra escalada de privilegios al asignar roles:
 *  - SUPER_ADMIN sólo lo puede otorgar/quitar un SUPER_ADMIN.
 *  - ADMIN sólo lo puede otorgar/quitar un ADMIN (o SUPER_ADMIN).
 * Sólo se evalúan los cambios: guardar un formulario sin tocar esos roles no se bloquea.
 * @returns {Promise<string|null>} mensaje de error o null si está permitido
 */
async function validarEscalada(req, valor, body) {
	const pedidos = idsPedidos(body);
	let actuales = new Set();
	try {
		const pack = await rolesService.obtenerRolesDePersonal(valor);
		actuales = new Set((pack?.roles || []).map((r) => Number(r.IdRol)));
	} catch (e) {
		// Si no se pueden leer los roles actuales, se valida sólo contra lo pedido.
		console.warn('[roles.validarEscalada] no se pudieron leer los roles actuales:', e.message);
	}
	if (esSuperAdminReq(req)) return { mensaje: null, actuales };

	const cambia = (id) => pedidos.has(id) !== actuales.has(id);

	if (cambia(ID_ROL_SUPER_ADMIN)) {
		return { mensaje: 'Solo un super administrador puede otorgar o quitar el rol SUPER_ADMIN', actuales };
	}
	if (cambia(ID_ROL_ADMIN) && !(await esAdminClinico(req))) {
		return { mensaje: 'Solo un administrador puede otorgar o quitar el rol ADMIN', actuales };
	}

	// Nadie puede otorgar un rol que incluya permisos que él mismo no tiene.
	const agregados = [...pedidos].filter((id) => !actuales.has(id));
	if (agregados.length && Array.isArray(req.permisos)) {
		const propios = new Set(req.permisos);
		const { permisos, roles } = await rolesService.permisosDeRoles(agregados);
		const faltantes = [...permisos].filter((c) => !propios.has(c));
		if (faltantes.length) {
			const nombres = roles.map((r) => r.Nombre).join(', ');
			return {
				mensaje: `No podés asignar ${nombres || 'ese rol'} porque incluye permisos que vos no tenés`,
				actuales,
			};
		}
	}
	return { mensaje: null, actuales };
}

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

		const { mensaje: bloqueo, actuales } = await validarEscalada(req, valor, body);
		if (bloqueo) {
			return res.status(403).json({ success: false, mensaje: bloqueo });
		}

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
		// Auditoría (sólo si ya existe el esquema de roles personalizados; nunca rompe el guardado)
		rolesCustom()
			.registrarAsignacion({
				idEmpresa: req.idEmpresa,
				actor: req.valorPersonal,
				valorPersonal: valor,
				antes: [...actuales],
				despues: result.roles.map((r) => Number(r.IdRol)),
			})
			.catch(() => {});
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
