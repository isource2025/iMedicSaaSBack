/**
 * Middleware de "propiedad del registro" para las secciones de Internación.
 *
 * Uso: `router.put('/:id', requireAuth, requirePropietario(opcionesTabla), controller.actualizar)`
 *
 * Verifica que el usuario logueado sea el mismo que creó el registro.
 * Si el campo de autoría no existe (tablas legacy), deja pasar (`failSafe = true`).
 *
 * Bypass de autoría: permiso `INTERNACION.REGISTROS.EDITAR_AJENOS` (no el nombre de rol).
 */
const { executeQuery } = require('../models/db');
const { claveDe } = require('../identidad/contrato');
const {
	resolveCodOperador,
	resolveValorPersonal,
	resolveMatricula,
} = require('../utils/sessionIdentity');
const { reqTienePermiso } = require('./requirePermiso.middleware');

const PERMISO_EDITAR_AJENOS = 'INTERNACION.REGISTROS.EDITAR_AJENOS';

/** ¿Puede editar registros clínicos ajenos? (antes: rol ADMIN). */
async function esAdminClinico(req) {
	try {
		return await reqTienePermiso(req, PERMISO_EDITAR_AJENOS);
	} catch (err) {
		console.warn('[propietario.middleware] esAdminClinico:', err.message);
		return false;
	}
}

function clavesPropias(req) {
	return [resolveCodOperador(req), resolveValorPersonal(req), resolveMatricula(req)].filter(
		(n) => n != null && Number(n) > 0,
	);
}

function coincideAutor(autor, identificadorSesion, req) {
	const n = Number(autor);
	if (!Number.isFinite(n)) return false;
	if (identificadorSesion != null && n === Number(identificadorSesion)) return true;
	return clavesPropias(req).some((k) => Number(k) === n);
}

function resolverIdentificadorSesion(req, { autorEsMatricula, tabla, autorCol }) {
	try {
		const clave = claveDe(`${tabla}.${autorCol}`);
		if (clave === 'operador') return resolveCodOperador(req);
		if (clave === 'ficha') return resolveValorPersonal(req);
		if (clave === 'matricula') return resolveMatricula(req);
	} catch {
		/* columna fuera del contrato: se usa el criterio de la ruta */
	}
	if (autorEsMatricula) return resolveMatricula(req);
	return resolveCodOperador(req);
}

/**
 * Misma regla que el middleware, sin `res`: la usa también el asistente.
 * @returns {Promise<{ ok: true } | { ok: false, status: number, mensaje: string, codigoError?: string }>}
 */
async function verificarPropiedad(
	req,
	{ tabla, pkCol, autorCol, failSafe = true, autorEsMatricula = false, permitirAdmin = true },
	pkRaw,
) {
	try {
		if (permitirAdmin && (await esAdminClinico(req))) return { ok: true };

		if (!pkRaw) {
			if (failSafe) return { ok: true };
			return { ok: false, status: 400, mensaje: 'ID de registro requerido' };
		}

		let identificadorSesion = resolverIdentificadorSesion(req, { autorEsMatricula, tabla, autorCol });

		if (identificadorSesion == null && autorEsMatricula && req.valorPersonal) {
			const mRows = await executeQuery(
				'SELECT Matricula FROM dbo.imPersonal WHERE Valor = @p0',
				[{ value: Number(req.valorPersonal) }],
			);
			const m = mRows[0]?.Matricula;
			const mNum = m != null && m !== '' ? Number(m) : NaN;
			if (Number.isFinite(mNum) && mNum > 0) {
				identificadorSesion = mNum;
				req.matricula = mNum;
			}
		}

		if (identificadorSesion == null) {
			if (failSafe) return { ok: true };
			return { ok: false, status: 401, mensaje: 'No autenticado' };
		}

		const rows = await executeQuery(
			`SELECT ${autorCol} AS AutorCarga FROM dbo.${tabla} WHERE ${pkCol} = @p0`,
			[{ value: Number(pkRaw) }],
		);

		if (!rows.length) {
			if (failSafe) return { ok: true };
			return { ok: false, status: 404, mensaje: 'Registro no encontrado' };
		}

		const autor = rows[0]?.AutorCarga;
		if (autor == null) {
			if (failSafe) return { ok: true };
			return { ok: false, status: 403, mensaje: 'No es posible verificar la propiedad del registro.' };
		}

		if (coincideAutor(autor, identificadorSesion, req)) return { ok: true };

		return {
			ok: false,
			status: 403,
			mensaje: 'Por restricciones legales, no puede modificar registros creados por otro profesional.',
			codigoError: 'REGISTRO_AJENO',
		};
	} catch (error) {
		console.error('[propietario.middleware]', error);
		if (failSafe) return { ok: true };
		return { ok: false, status: 500, mensaje: 'Error al verificar propiedad del registro' };
	}
}

function requirePropietario(opciones) {
	const pkParam = opciones.pkParam || 'id';
	return async (req, res, next) => {
		const r = await verificarPropiedad(req, opciones, req.params[pkParam]);
		if (r.ok) return next();
		const body = { success: false, mensaje: r.mensaje };
		if (r.codigoError) body.codigoError = r.codigoError;
		return res.status(r.status).json(body);
	};
}

module.exports = {
	requirePropietario,
	verificarPropiedad,
	esAdminClinico,
	coincideAutor,
	PERMISO_EDITAR_AJENOS,
};
