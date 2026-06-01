const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');

/** Evita "Illegal mix of collations" entre tablas importadas con distinto utf8mb4 */
const COLLATE = 'utf8mb4_unicode_ci';
const USER_MATCH = `LOWER(TRIM(COALESCE(NULLIF(pw.NombreRed, ''), ''))) COLLATE ${COLLATE}`;
const ROL_JOIN = `CAST(r.IdRol AS CHAR) COLLATE ${COLLATE} = TRIM(p.Rol) COLLATE ${COLLATE}`;

let empresasMysqlColumnsCache = null;

function normalizarUsername(username) {
	return String(username || '').trim().toLowerCase();
}

async function getEmpresasMysqlColumns() {
	if (empresasMysqlColumnsCache) return empresasMysqlColumnsCache;
	const rows = await query(
		`
    SELECT COLUMN_NAME AS col
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas'
    `,
	);
	empresasMysqlColumnsCache = new Set(rows.map((r) => String(r.col || '').toLowerCase()));
	return empresasMysqlColumnsCache;
}

function mapUsuario(row) {
	if (!row) return null;
	return {
		ValorPersonal: Number(row.ValorPersonal),
		NombreRed: row.NombreRed,
		Nombrered: row.NombreRed,
		nombrered: row.NombreRed,
		Password: row.Password,
		Nombres: row.Nombres || '',
		Apellido: row.Apellido || '',
		CodOperador: row.CodOperador || '',
		Grupo: row.Grupo != null ? Number(row.Grupo) : null,
		NumeroDocumento: row.NumeroDocumento || null,
		Matricula: row.Matricula != null ? Number(row.Matricula) : null,
		RolId: row.RolId != null ? Number(row.RolId) : null,
		RolNombre: row.RolNombre || '',
		RolNivel: row.RolNivel != null ? Number(row.RolNivel) : 0,
	};
}

async function query(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function autenticarPlataforma(username, password) {
	if (!isAuthCentralEnabled()) return null;
	const rows = await query(
		`
    SELECT
      pw.*,
      p.Matricula AS Matricula,
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      r.Nivel AS RolNivel
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p ON p.Valor = pw.ValorPersonal
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
      AND pw.Password = ?
      AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) = '5'
        OR COALESCE(pw.Grupo, 0) = 11
      )
    LIMIT 1
    `,
		[normalizarUsername(username), String(password || '')],
	);
	return rows.length ? mapUsuario(rows[0]) : null;
}

async function autenticarTenant(idEmpresa, username, password) {
	if (!isAuthCentralEnabled()) return null;
	const rows = await query(
		`
    SELECT
      pw.*,
      p.Matricula AS Matricula,
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      r.Nivel AS RolNivel
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe
      ON pe.IdPersonal = pw.ValorPersonal
     AND pe.IdEmpresa = ?
    LEFT JOIN \`imPersonal\` p ON p.Valor = pw.ValorPersonal
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
      AND pw.Password = ?
    LIMIT 1
    `,
		[Number(idEmpresa), normalizarUsername(username), String(password || '')],
	);
	return rows.length ? mapUsuario(rows[0]) : null;
}

async function autenticarEnTodasLasEmpresas(username, password) {
	if (!isAuthCentralEnabled()) return [];
	const rows = await query(
		`
    SELECT
      pe.IdEmpresa AS idEmpresa,
      TRIM(COALESCE(e.DESCRIPCION, '')) AS descripcionEmpresa,
      pw.*,
      p.Matricula AS Matricula,
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      r.Nivel AS RolNivel
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON pe.IdPersonal = pw.ValorPersonal
    INNER JOIN \`Empresas\` e ON e.IDEMPRESA = pe.IdEmpresa
    LEFT JOIN \`imPersonal\` p ON p.Valor = pw.ValorPersonal
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
      AND pw.Password = ?
    ORDER BY descripcionEmpresa
    `,
		[normalizarUsername(username), String(password || '')],
	);
	return rows.map((row) => ({
		idEmpresa: Number(row.idEmpresa),
		descripcionEmpresa: String(row.descripcionEmpresa || '').trim(),
		usuario: mapUsuario(row),
	}));
}

async function descubrirEmpresas(username) {
	if (!isAuthCentralEnabled()) return [];
	const u = normalizarUsername(username);
	const rows = await query(
		`
    SELECT DISTINCT
      pe.IdEmpresa AS idEmpresa,
      TRIM(COALESCE(e.DESCRIPCION, '')) AS descripcionEmpresa,
      pw.ValorPersonal AS valorPersonal
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON pe.IdPersonal = pw.ValorPersonal
    INNER JOIN \`Empresas\` e ON e.IDEMPRESA = pe.IdEmpresa
    WHERE ${USER_MATCH} = ?
    ORDER BY descripcionEmpresa
    `,
		[u],
	);
	return rows.map((row) => ({
		idEmpresa: Number(row.idEmpresa),
		descripcionEmpresa: String(row.descripcionEmpresa || '').trim(),
		valorPersonal: Number(row.valorPersonal),
		fuente: 'auth_central',
	}));
}

async function obtenerSectores(username, idEmpresa) {
	if (!isAuthCentralEnabled()) return [];
	const rows = await query(
		`
    SELECT DISTINCT
      ps.idPersonal AS idPersonal,
      ps.idSector AS idSector,
      s.Descripcion AS descripcionSector
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe
      ON pe.IdPersonal = pw.ValorPersonal
     AND pe.IdEmpresa = ?
    INNER JOIN \`imPersonalSectores\` ps ON ps.idPersonal = pw.ValorPersonal
    INNER JOIN \`imSectores\` s ON s.Valor = ps.idSector
    WHERE ${USER_MATCH} = ?
    ORDER BY descripcionSector
    `,
		[Number(idEmpresa), normalizarUsername(username)],
	);
	return rows.map((row) => ({
		idPersonal: String(row.idPersonal),
		idSector: String(row.idSector),
		descripcionSector: String(row.descripcionSector || '').trim(),
	}));
}

async function obtenerDescripcionSector(idEmpresa, idSector) {
	if (!isAuthCentralEnabled()) return null;
	const rows = await query(
		`
    SELECT Valor AS idSector, Descripcion AS descripcion
    FROM \`imSectores\`
    WHERE Valor = ?
    LIMIT 1
    `,
		[String(idSector)],
	);
	return rows[0] || null;
}

async function obtenerSectorPorPersonal(idEmpresa, idPersonal) {
	if (!isAuthCentralEnabled()) return null;
	const rows = await query(
		`
    SELECT
      ps.idSector AS idSector,
      s.Descripcion AS descripcion
    FROM \`imPersonalSectores\` ps
    INNER JOIN \`imSectores\` s ON s.Valor = ps.idSector
    INNER JOIN \`imPersonalEmpresas\` pe
      ON pe.IdPersonal = ps.idPersonal
     AND pe.IdEmpresa = ?
    WHERE ps.idPersonal = ?
    LIMIT 1
    `,
		[Number(idEmpresa), Number(idPersonal)],
	);
	return rows[0] || null;
}

async function esSuperAdmin(username) {
	if (!isAuthCentralEnabled()) return false;
	const rows = await query(
		`
    SELECT 1
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p ON p.Valor = pw.ValorPersonal
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
      AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) = '5'
        OR COALESCE(pw.Grupo, 0) = 11
      )
    LIMIT 1
    `,
		[normalizarUsername(username)],
	);
	return rows.length > 0;
}

async function obtenerEmpresaPorId(idEmpresa) {
	if (!isAuthCentralEnabled()) return null;
	const cols = await getEmpresasMysqlColumns();
	const dbPasswordCol = cols.has('dbpassword') ? 'DbPassword,' : '';
	const rows = await query(
		`
    SELECT
      IDEMPRESA, DESCRIPCION, calle, calle_nro, Depto, piso, localidad, Provincia,
      Nro_CUIT, Nro_IngBrutos, IdTipoIVA, TEEmpresa, Email,
      DbServer, DbPort, DbInstance, DbName, DbUser, ${dbPasswordCol} DbPasswordEnc
    FROM \`Empresas\`
    WHERE IDEMPRESA = ?
    LIMIT 1
    `,
		[Number(idEmpresa)],
	);
	return rows[0] || null;
}

async function obtenerTodasEmpresas() {
	if (!isAuthCentralEnabled()) return [];
	return query(
		`
    SELECT IDEMPRESA AS idEmpresa, TRIM(COALESCE(DESCRIPCION, '')) AS descripcionEmpresa
    FROM \`Empresas\`
    ORDER BY DESCRIPCION
    `,
	);
}

async function obtenerPacksEmpresa(idEmpresa) {
	if (!isAuthCentralEnabled()) return [];
	const rows = await query(
		`
    SELECT CodigoPack, Activo
    FROM \`EmpresasModuloPack\`
    WHERE IdEmpresa = ? AND Activo = 1
    ORDER BY CodigoPack
    `,
		[Number(idEmpresa)],
	);
	return rows.map((row) => String(row.CodigoPack));
}

async function permisosDeRol(idRol) {
	if (!isAuthCentralEnabled()) return [];
	const rows = await query(
		`
    SELECT p.Codigo
    FROM \`imRolPermisos\` rp
    INNER JOIN \`imPermisos\` p ON p.IdPermiso = rp.IdPermiso
    WHERE rp.IdRol = ?
    ORDER BY p.Codigo
    `,
		[Number(idRol)],
	);
	return rows.map((row) => String(row.Codigo || '')).filter(Boolean);
}

module.exports = {
	isAuthCentralEnabled,
	autenticarPlataforma,
	autenticarTenant,
	autenticarEnTodasLasEmpresas,
	descubrirEmpresas,
	obtenerSectores,
	obtenerDescripcionSector,
	obtenerSectorPorPersonal,
	esSuperAdmin,
	obtenerEmpresaPorId,
	obtenerTodasEmpresas,
	obtenerPacksEmpresa,
	permisosDeRol,
};
