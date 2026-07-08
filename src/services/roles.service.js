/**
 * Servicio de Roles.
 *
 * - Lectura del catálogo `imRoles`.
 * - Asignación de un rol a un personal mediante `imPersonal.Rol` (varchar(20),
 *   guarda el IdRol como string).
 *
 * Decisión de modelado: el rol vive en `imPersonal.Rol`. Un usuario tiene
 * a lo sumo un rol. La tabla `imRoles` actúa como catálogo (no relaciona
 * usuarios). Si más adelante se necesita multi-rol, se agregará una tabla
 * de relación sin tocar este servicio.
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const { isAuthCentralEnabled } = require('../config/authCentralDb');
const authCentralService = require('./authCentral.service');
const authCentralSync = require('./authCentralSync.service');
const nubeTenant = require('./nubeTenant.service');
let _permisosService;
function _invalidarCachePermisos(idRol) {
	try {
		_permisosService = _permisosService || require('./permisos.service');
		_permisosService.invalidarCache(idRol);
	} catch (_) {
		// silent
	}
}

function _mapRolCentral(r) {
	if (!r) return null;
	return {
		IdRol: r.IdRol,
		Nombre: r.Nombre,
		Descripcion: r.Descripcion || '',
		Nivel: r.Nivel ?? 0,
		Activo: true,
	};
}

function esErrorEsquemaRoles(error) {
	const msg = String(error?.message || '').toLowerCase();
	return (
		msg.includes("invalid object name 'imroles'") ||
		msg.includes("invalid column name 'rol'") ||
		msg.includes("invalid object name 'impersonal'")
	);
}

function _usaAuthRailway() {
	if (!isAuthCentralEnabled()) return false;
	const idEmpresa = getTenantId();
	return idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0;
}

function _parseApellidoNombre(apellidoNombre) {
	const s = String(apellidoNombre || '').trim();
	if (!s) return { apellido: '', nombres: '' };
	if (s.includes(',')) {
		const [apellido, ...rest] = s.split(',');
		return { apellido: apellido.trim(), nombres: rest.join(',').trim() };
	}
	return { apellido: s, nombres: '' };
}

async function _leerDatosPersonalFisico(vp) {
	const rows = await executeQuery(
		`SELECT TOP 1 ApellidoNombre, Numero FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: vp, type: 'Int' }],
	);
	if (!rows.length) return null;
	const { apellido, nombres } = _parseApellidoNombre(rows[0].ApellidoNombre);
	return { apellido, nombres, numeroDocumento: rows[0].Numero };
}

/**
 * Garantiza ficha en Railway MySQL (como el wizard Super Admin) leyendo datos del SQL físico.
 */
async function _asegurarFichaPersonalEnRailway(idEmpresa, vp, { idRol } = {}) {
	await authCentralSync.syncPersonal(idEmpresa, vp);
	await authCentralSync.syncPersonalEmpresa(idEmpresa, vp);

	const datos = await _leerDatosPersonalFisico(vp);
	if (!datos) {
		const e = new Error('Personal no encontrado');
		e.statusCode = 404;
		throw e;
	}

	const payload = {
		apellido: datos.apellido,
		nombres: datos.nombres,
		numeroDocumento: datos.numeroDocumento,
	};
	if (idRol !== undefined) payload.idRol = idRol;
	await nubeTenant.asegurarFichaPersonal(idEmpresa, vp, payload);
}

/** Espejo opcional al SQL físico del tenant (empresas FÍSICO). */
async function _espejarRolEnFisico(valorPersonal, idRol) {
	try {
		const checkRows = await executeQuery(
			`SELECT TOP 1 Valor FROM dbo.imPersonal WHERE Valor = @p0`,
			[{ value: Number(valorPersonal), type: 'Int' }],
		);
		if (!checkRows.length) return;
		const rolValor =
			idRol == null || idRol === '' || Number(idRol) === 0 ? null : String(Number(idRol));
		await executeQuery(`UPDATE dbo.imPersonal SET Rol = @p1 WHERE Valor = @p0`, [
			{ value: Number(valorPersonal), type: 'Int' },
			{ value: rolValor, type: 'VarChar' },
		]);
	} catch (e) {
		console.warn('[roles] espejo físico:', e.message);
	}
}

/** Lee Rol crudo del SQL físico y resuelve contra el catálogo Railway. */
async function _obtenerRolDePersonalEnFisico(valorPersonal) {
	const rows = await executeQuery(
		`
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS Rol
    FROM dbo.imPersonal p
    WHERE p.Valor = @p0
    `,
		[{ value: Number(valorPersonal), type: 'Int' }],
	);
	const rolStr = String(rows[0]?.Rol || '').trim();
	if (!rolStr) return null;
	const idRol = Number(rolStr);
	if (!Number.isFinite(idRol) || idRol <= 0) return null;
	return obtenerRolPorId(idRol);
}

/** Lista todos los roles activos del catálogo, ordenados por nivel descendente. */
async function listarRoles() {
	if (isAuthCentralEnabled()) {
		const rows = await authCentralService.listarRolesCatalogo();
		return rows.map((r) => ({
			IdRol: r.IdRol,
			Nombre: r.Nombre,
			Descripcion: r.Descripcion,
			Nivel: r.Nivel,
			Activo: true,
		}));
	}
	const rows = await executeQuery(
		`
    SELECT
      IdRol,
      LTRIM(RTRIM(Nombre)) AS Nombre,
      LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
      Nivel,
      Activo
    FROM dbo.imRoles
    WHERE Activo = 1
    ORDER BY Nivel DESC, Nombre ASC
    `,
	);
	return rows.map((r) => ({
		IdRol: Number(r.IdRol),
		Nombre: String(r.Nombre || ''),
		Descripcion: String(r.Descripcion || ''),
		Nivel: Number(r.Nivel ?? 0),
		Activo: !!r.Activo,
	}));
}

/** Obtiene un rol por su Id. Devuelve null si no existe o está inactivo. */
async function obtenerRolPorId(idRol) {
	if (idRol == null) return null;
	if (isAuthCentralEnabled()) {
		const r = await authCentralService.obtenerRolPorId(idRol);
		if (r) {
			return {
				IdRol: r.IdRol,
				Nombre: r.Nombre,
				Descripcion: r.Descripcion,
				Nivel: r.Nivel,
				Activo: true,
			};
		}
		return null;
	}
	const rows = await executeQuery(
		`
    SELECT TOP 1
      IdRol,
      LTRIM(RTRIM(Nombre)) AS Nombre,
      LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
      Nivel,
      Activo
    FROM dbo.imRoles
    WHERE IdRol = @p0 AND Activo = 1
    `,
		[{ value: Number(idRol), type: 'Int' }],
	);
	if (!rows.length) return null;
	const r = rows[0];
	return {
		IdRol: Number(r.IdRol),
		Nombre: String(r.Nombre || ''),
		Descripcion: String(r.Descripcion || ''),
		Nivel: Number(r.Nivel ?? 0),
		Activo: !!r.Activo,
	};
}

/**
 * Asigna (o limpia) el rol de un personal.
 *
 * @param {number} valorPersonal - imPersonal.Valor
 * @param {number|null} idRol - IdRol válido de imRoles, o null para limpiar.
 * @returns el rol resultante (o null si quedó sin rol).
 */
async function asignarRolAPersonal(valorPersonal, idRol) {
	if (!Number.isFinite(Number(valorPersonal))) {
		const e = new Error('valorPersonal inválido');
		e.statusCode = 400;
		throw e;
	}

	const vp = Number(valorPersonal);
	const idEmpresa = Number(getTenantId());
	const enRailway = _usaAuthRailway();

	// Limpiar rol
	if (idRol == null || idRol === '' || idRol === 0) {
		if (enRailway) {
			await _asegurarFichaPersonalEnRailway(idEmpresa, vp);
			await authCentralService.asignarRolDeValorPersonal(idEmpresa, vp, null);
		} else {
			await executeQuery(`UPDATE dbo.imPersonal SET Rol = NULL WHERE Valor = @p0`, [
				{ value: vp, type: 'Int' },
			]);
		}
		await _espejarRolEnFisico(vp, null);
		return null;
	}

	// Validar que el rol existe y está activo (catálogo Railway en producción)
	const rol = await obtenerRolPorId(idRol);
	if (!rol) {
		const e = new Error('El rol indicado no existe o está inactivo');
		e.statusCode = 400;
		throw e;
	}

	if (enRailway) {
		await _asegurarFichaPersonalEnRailway(idEmpresa, vp);
		const asignado = await authCentralService.asignarRolDeValorPersonal(
			idEmpresa,
			vp,
			rol.IdRol,
		);
		await _espejarRolEnFisico(vp, rol.IdRol);
		_invalidarCachePermisos(rol.IdRol);
		return _mapRolCentral(asignado) || rol;
	}

	// Legacy: solo SQL físico del tenant
	const checkRows = await executeQuery(
		`SELECT TOP 1 Valor FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: vp, type: 'Int' }],
	);
	if (!checkRows.length) {
		const e = new Error('Personal no encontrado');
		e.statusCode = 404;
		throw e;
	}

	await executeQuery(`UPDATE dbo.imPersonal SET Rol = @p1 WHERE Valor = @p0`, [
		{ value: vp, type: 'Int' },
		{ value: String(rol.IdRol), type: 'VarChar' },
	]);

	_invalidarCachePermisos(rol.IdRol);
	return rol;
}

/**
 * Lee el rol de un personal a partir de su Valor.
 * Devuelve null si no tiene rol asignado.
 */
async function obtenerRolDePersonal(valorPersonal) {
	if (!Number.isFinite(Number(valorPersonal))) return null;
	const vp = Number(valorPersonal);
	const idEmpresa = Number(getTenantId());

	if (_usaAuthRailway()) {
		try {
			const r = await authCentralService.obtenerRolDeValorPersonal(idEmpresa, vp);
			if (r) return _mapRolCentral(r);

			const fisico = await _obtenerRolDePersonalEnFisico(vp);
			if (fisico) {
				await _asegurarFichaPersonalEnRailway(idEmpresa, vp);
				await authCentralService.asignarRolDeValorPersonal(idEmpresa, vp, fisico.IdRol);
				return fisico;
			}
		} catch (e) {
			if (!esErrorEsquemaRoles(e)) {
				console.warn('[roles] obtenerRolDePersonal Railway:', e.message);
			}
		}
		return null;
	}

	try {
		const rows = await executeQuery(
			`
    SELECT TOP 1
      LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS RolId
    FROM dbo.imPersonal p
    WHERE p.Valor = @p0
    `,
			[{ value: vp, type: 'Int' }],
		);
		const rolStr = String(rows[0]?.RolId || '').trim();
		if (!rolStr) return null;
		const idRol = Number(rolStr);
		if (!Number.isFinite(idRol) || idRol <= 0) return null;
		return obtenerRolPorId(idRol);
	} catch (e) {
		if (esErrorEsquemaRoles(e)) return null;
		throw e;
	}
}

module.exports = {
	listarRoles,
	obtenerRolPorId,
	asignarRolAPersonal,
	obtenerRolDePersonal,
};
