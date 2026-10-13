/**
 * Middleware de "propiedad del registro" para las secciones de Internación.
 *
 * Uso: `router.put('/:id', requireAuth, requirePropietario(opcionesTabla), controller.actualizar)`
 *
 * Verifica que el usuario logueado (`req.auth.usuario.codOperador`) sea el
 * mismo que creó el registro.  Si el campo de autoría no existe en la tabla
 * (tablas legacy sin columna de autor), deja pasar (`failSafe = true` por
 * defecto) porque no podemos bloquear retroactivamente.
 *
 * Opciones:
 *   tabla        {string}  Nombre de la tabla (ej: 'imInterIndMedicas')
 *   pkCol        {string}  Columna PK (ej: 'Valor')
 *   autorCol     {string}  Columna que guarda el CodOperador del creador
 *                          (ej: 'OperadorCarga') o la Matricula (ej: 'Profecional')
 *   pkParam      {string}  Nombre del param de ruta (default: 'id')
 *   autorEsMatricula {boolean} Si true, compara contra req.matricula / JWT matricula
 *                              (imHCEvolucion.Profecional guarda matrícula, no CodOperador)
 *   failSafe     {boolean} Si es true (default), cuando NO hay columna de
 *                          autor o no hay registro deja pasar. Si es false,
 *                          bloquea ante la duda.
 *   permitirAdmin {boolean} Si true (default), rol ADMIN omite verificación de autor.
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const authCentralService = require('../services/authCentral.service');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

/** ADMIN de tenant: puede editar registros ajenos en internación. */
async function esAdminClinico(req) {
	const rn = req.rolNombre ?? req.auth?.rol?.nombre;
	const rolNombre = rn ? String(rn).trim().toUpperCase() : '';
	if (rolNombre === 'ADMIN') return true;
	const rolId = req.auth?.rol?.id;
	if (rolId != null && Number(rolId) === 1) return true;

	if (!req.valorPersonal) return false;

	if (isAuthCentralEnabled()) {
		const idEmpresa = getTenantId();
		if (idEmpresa != null && Number(idEmpresa) > 0) {
			try {
				const r = await authCentralService.obtenerRolDeValorPersonal(
					Number(idEmpresa),
					Number(req.valorPersonal),
				);
				if (r) {
					const nombre = String(r.nombre || '').toUpperCase();
					if (nombre === 'ADMIN' || Number(r.idRol) === 1) return true;
				}
			} catch (_) {
				/* ignore */
			}
		}
	}

	try {
		const rows = await executeQuery(
			`
      SELECT
        pw.Grupo,
        LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS RolId
      FROM dbo.imPassword pw
      LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
      WHERE pw.ValorPersonal = @p0
      `,
			[{ value: Number(req.valorPersonal) }],
		);
		const row = rows[0];
		if (!row) return false;
		if (Number(row.Grupo) === 11) return true;
		const dbRolId = row.RolId != null && row.RolId !== '' ? Number(row.RolId) : NaN;
		if (Number.isFinite(dbRolId) && dbRolId === 1) return true;
	} catch (err) {
		console.warn('[propietario.middleware] esAdminClinico:', err.message);
	}

	return false;
}

function coincideAutor(autor, identificadorSesion, req) {
	if (identificadorSesion != null && Number(autor) === Number(identificadorSesion)) {
		return true;
	}
	// imHCEvolucion legacy: Profecional suele guardar ValorPersonal (idPersonal del sector), no Matricula
	if (req.valorPersonal != null && Number(autor) === Number(req.valorPersonal)) {
		return true;
	}
	const u = req.auth?.usuario || {};
	const codCandidates = [u.codOperador, u.idCodOperador, u.CodOperador];
	for (const c of codCandidates) {
		if (c != null && c !== '' && Number(autor) === Number(c)) return true;
	}
	return false;
}

function resolverIdentificadorSesion(req, { autorEsMatricula }) {
	if (autorEsMatricula) {
		const mat = req.matricula ?? req.auth?.usuario?.matricula;
		const matNum = mat != null && mat !== '' ? Number(mat) : NaN;
		if (Number.isFinite(matNum) && matNum > 0) return matNum;
	}
	const u = req.auth?.usuario || {};
	const candidates = [u.codOperador, u.idCodOperador, u.CodOperador];
	for (const c of candidates) {
		if (c == null || c === '') continue;
		const n = Number(c);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

/**
 * Misma regla que el middleware, sin `res`: la usa también el asistente para
 * no ofrecer cambios que el backend va a rechazar.
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

		let identificadorSesion = resolverIdentificadorSesion(req, { autorEsMatricula });

		// JWT legacy (Render) puede traer id pero no matricula: resolver desde imPersonal
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

module.exports = { requirePropietario, verificarPropiedad, esAdminClinico, coincideAutor };
