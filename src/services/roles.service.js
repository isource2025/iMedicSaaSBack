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
let _permisosService;
function _invalidarCachePermisos(idRol) {
	try {
		_permisosService = _permisosService || require('./permisos.service');
		_permisosService.invalidarCache(idRol);
	} catch (_) {
		// silent
	}
}

/** Lista todos los roles activos del catálogo, ordenados por nivel descendente. */
async function listarRoles() {
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

	// Limpiar rol
	if (idRol == null || idRol === '' || idRol === 0) {
		await executeQuery(`UPDATE dbo.imPersonal SET Rol = NULL WHERE Valor = @p0`, [
			{ value: Number(valorPersonal), type: 'Int' },
		]);
		return null;
	}

	// Validar que el rol existe y está activo
	const rol = await obtenerRolPorId(idRol);
	if (!rol) {
		const e = new Error('El rol indicado no existe o está inactivo');
		e.statusCode = 400;
		throw e;
	}

	// Validar que el personal existe
	const checkRows = await executeQuery(
		`SELECT TOP 1 Valor FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: Number(valorPersonal), type: 'Int' }],
	);
	if (!checkRows.length) {
		const e = new Error('Personal no encontrado');
		e.statusCode = 404;
		throw e;
	}

	await executeQuery(
		`UPDATE dbo.imPersonal SET Rol = @p1 WHERE Valor = @p0`,
		[
			{ value: Number(valorPersonal), type: 'Int' },
			{ value: String(rol.IdRol), type: 'VarChar' },
		],
	);

	// Invalida la caché de permisos del rol nuevo (los demás roles no
	// cambian, sólo el usuario afectado tiene un rol distinto la próxima
	// vez que loguee).
	_invalidarCachePermisos(rol.IdRol);

	return rol;
}

/**
 * Lee el rol de un personal a partir de su Valor.
 * Devuelve null si no tiene rol asignado.
 */
async function obtenerRolDePersonal(valorPersonal) {
	if (!Number.isFinite(Number(valorPersonal))) return null;
	const rows = await executeQuery(
		`
    SELECT TOP 1
      r.IdRol,
      LTRIM(RTRIM(r.Nombre)) AS Nombre,
      LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion,
      r.Nivel,
      r.Activo
    FROM dbo.imPersonal p
    INNER JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol))
    WHERE p.Valor = @p0
    `,
		[{ value: Number(valorPersonal), type: 'Int' }],
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

module.exports = {
	listarRoles,
	obtenerRolPorId,
	asignarRolAPersonal,
	obtenerRolDePersonal,
};
