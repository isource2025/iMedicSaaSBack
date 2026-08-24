const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const passwordService = require('./password.service');
const { dedupeEmpresasPorId } = require('../utils/authEmpresas');

/** Evita "Illegal mix of collations" entre tablas importadas con distinto utf8mb4 */
const COLLATE = 'utf8mb4_unicode_ci';
const USER_MATCH = `LOWER(TRIM(COALESCE(NULLIF(pw.NombreRed, ''), ''))) COLLATE ${COLLATE}`;
const ROL_JOIN = `CAST(r.IdRol AS CHAR) COLLATE ${COLLATE} = TRIM(p.Rol) COLLATE ${COLLATE}`;
const JOIN_PERSONAL = `p.Valor = pw.ValorPersonal AND p.IdEmpresa = pw.IdEmpresa`;
const JOIN_PERSONAL_EMPRESA = `pe.IdPersonal = pw.ValorPersonal AND pe.IdEmpresa = pw.IdEmpresa`;

let empresasMysqlColumnsCache = null;

function normalizarUsername(username) {
	return String(username || '').trim().toLowerCase();
}

/** Nombres/Apellido desde imPassword o ApellidoNombre de imPersonal (legacy). */
function splitApellidoNombre(apellidoNombre) {
	const s = String(apellidoNombre || '').trim();
	if (!s) return { nombres: '', apellido: '' };
	// Formato típico: "Apellido, Nombre" o "Apellido Nombre"
	if (s.includes(',')) {
		const [ap, ...rest] = s.split(',');
		return { apellido: ap.trim(), nombres: rest.join(',').trim() };
	}
	const parts = s.split(/\s+/).filter(Boolean);
	if (parts.length === 1) return { nombres: parts[0], apellido: '' };
	return { apellido: parts[0], nombres: parts.slice(1).join(' ') };
}

function isDebilNombre(value) {
	const s = String(value || '').trim();
	if (!s) return true;
	// Valores basura frecuentes: grupo numérico, codigos, "null"
	if (/^\d+$/.test(s)) return true;
	if (/^(null|undefined|n\/a)$/i.test(s)) return true;
	return false;
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

const PERSONAL_AUTH_SELECT = `
      p.Matricula AS Matricula,
      p.ApellidoNombre AS ApellidoNombre,
      TRIM(COALESCE(p.Rol, '')) AS PersonalRol,
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      r.Nivel AS RolNivel
`;

function mapUsuario(row) {
	if (!row) return null;
	let nombres = String(row.Nombres || '').trim();
	let apellido = String(row.Apellido || '').trim();
	if (isDebilNombre(nombres) && isDebilNombre(apellido)) {
		const fromPersonal = splitApellidoNombre(row.ApellidoNombre || row.apellidoNombre);
		if (!isDebilNombre(fromPersonal.nombres) || !isDebilNombre(fromPersonal.apellido)) {
			nombres = fromPersonal.nombres;
			apellido = fromPersonal.apellido;
		}
	}
	// Si el apellido quedó basura y el nombre no, o viceversa, limpiar
	if (isDebilNombre(nombres)) nombres = '';
	if (isDebilNombre(apellido)) apellido = '';

	return {
		ValorPersonal: Number(row.ValorPersonal),
		IdEmpresa: row.IdEmpresa != null ? Number(row.IdEmpresa) : null,
		NombreRed: row.NombreRed,
		Nombrered: row.NombreRed,
		nombrered: row.NombreRed,
		Password: row.Password,
		Nombres: nombres,
		Apellido: apellido,
		CodOperador: row.CodOperador || '',
		Grupo: row.Grupo != null ? Number(row.Grupo) : null,
		NumeroDocumento: row.NumeroDocumento || null,
		Matricula: row.Matricula != null ? Number(row.Matricula) : null,
		RolId: row.RolId != null ? Number(row.RolId) : null,
		RolNombre: row.RolNombre || '',
		RolNivel: row.RolNivel != null ? Number(row.RolNivel) : 0,
		PersonalRol: row.PersonalRol != null ? String(row.PersonalRol).trim() : '',
	};
}

async function query(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function autenticarPlataforma(username, password) {
	if (!isAuthCentralEnabled()) return null;
	// Solo filas de plataforma (IdEmpresa=0). Nunca cuentas de hospital.
	const rows = await query(
		`
    SELECT
      pw.*,
      ${PERSONAL_AUTH_SELECT}
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p ON ${JOIN_PERSONAL}
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE COALESCE(pw.IdEmpresa, 0) = 0
      AND ${USER_MATCH} = ?
      AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) COLLATE ${COLLATE} = '5'
        OR COALESCE(pw.Grupo, 0) = 11
      )
    LIMIT 3
    `,
		[normalizarUsername(username)],
	);
	if (!rows.length) return null;
	for (const row of rows) {
		if (!(await passwordService.verifyPassword(password, row))) continue;
		await passwordService.upgradePasswordHashCentral(
			0,
			row.ValorPersonal,
			password,
		);
		return mapUsuario(row);
	}
	return null;
}

async function autenticarTenant(idEmpresa, username, password) {
	if (!isAuthCentralEnabled()) return null;
	const emp = Number(idEmpresa);
	const rows = await query(
		`
    SELECT
      pw.*,
      ${PERSONAL_AUTH_SELECT}
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON ${JOIN_PERSONAL_EMPRESA} AND pe.IdEmpresa = ?
    LEFT JOIN \`imPersonal\` p ON ${JOIN_PERSONAL}
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE pw.IdEmpresa = ?
      AND ${USER_MATCH} = ?
    LIMIT 1
    `,
		[emp, emp, normalizarUsername(username)],
	);
	if (!rows.length) return null;
	if (!(await passwordService.verifyPassword(password, rows[0]))) return null;
	await passwordService.upgradePasswordHashCentral(emp, rows[0].ValorPersonal, password);
	return mapUsuario(rows[0]);
}

async function autenticarEnTodasLasEmpresas(username, password) {
	if (!isAuthCentralEnabled()) return [];
	const rows = await query(
		`
    SELECT
      pe.IdEmpresa AS idEmpresa,
      TRIM(COALESCE(e.DESCRIPCION, '')) AS descripcionEmpresa,
      pw.*,
      ${PERSONAL_AUTH_SELECT}
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON ${JOIN_PERSONAL_EMPRESA}
    INNER JOIN \`Empresas\` e ON e.IDEMPRESA = pe.IdEmpresa
    LEFT JOIN \`imPersonal\` p ON ${JOIN_PERSONAL}
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
      AND COALESCE(pw.IdEmpresa, 0) > 0
    ORDER BY descripcionEmpresa
    `,
		[normalizarUsername(username)],
	);
	const matches = [];
	for (const row of rows) {
		if (!(await passwordService.verifyPassword(password, row))) continue;
		await passwordService.upgradePasswordHashCentral(row.IdEmpresa, row.ValorPersonal, password);
		matches.push({
			idEmpresa: Number(row.idEmpresa),
			descripcionEmpresa: String(row.descripcionEmpresa || '').trim(),
			usuario: mapUsuario(row),
			Grupo: row.Grupo,
			RolNombre: row.RolNombre,
		});
	}
	return dedupeEmpresasPorId(matches);
}

async function descubrirEmpresas(username) {
	if (!isAuthCentralEnabled()) return [];
	const u = normalizarUsername(username);
	const rows = await query(
		`
    SELECT
      pe.IdEmpresa AS idEmpresa,
      TRIM(COALESCE(e.DESCRIPCION, '')) AS descripcionEmpresa,
      MIN(pw.ValorPersonal) AS valorPersonal
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON ${JOIN_PERSONAL_EMPRESA}
    INNER JOIN \`Empresas\` e ON e.IDEMPRESA = pe.IdEmpresa
    WHERE ${USER_MATCH} = ?
      AND COALESCE(pw.IdEmpresa, 0) > 0
      AND COALESCE(pe.IdEmpresa, 0) > 0
    GROUP BY pe.IdEmpresa, e.DESCRIPCION
    ORDER BY descripcionEmpresa
    `,
		[u],
	);
	return dedupeEmpresasPorId(
		rows.map((row) => ({
			idEmpresa: Number(row.idEmpresa),
			descripcionEmpresa: String(row.descripcionEmpresa || '').trim(),
			valorPersonal: Number(row.valorPersonal),
			fuente: 'auth_central',
		})),
	);
}

async function obtenerSectores(username, idEmpresa) {
	if (!isAuthCentralEnabled()) return [];
	const emp = Number(idEmpresa);
	const rows = await query(
		`
    SELECT DISTINCT
      ps.idPersonal AS idPersonal,
      ps.idSector AS idSector,
      s.Descripcion AS descripcionSector
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON ${JOIN_PERSONAL_EMPRESA} AND pe.IdEmpresa = ?
    INNER JOIN \`imPersonalSectores\` ps
      ON ps.idPersonal = pw.ValorPersonal AND ps.IdEmpresa = pw.IdEmpresa
    INNER JOIN \`imSectores\` s
      ON s.Valor COLLATE ${COLLATE} = ps.idSector COLLATE ${COLLATE}
     AND s.IdEmpresa = pe.IdEmpresa
    WHERE pw.IdEmpresa = ?
      AND ${USER_MATCH} = ?
    ORDER BY descripcionSector
    `,
		[emp, emp, normalizarUsername(username)],
	);
	return rows.map((row) => ({
		idPersonal: String(row.idPersonal),
		idSector: String(row.idSector),
		descripcionSector: String(row.descripcionSector || '').trim(),
		valorServicio: String(row.valorServicio || row.ValorServicio || '').trim(),
	}));
}

async function obtenerDescripcionSector(idEmpresa, idSector) {
	if (!isAuthCentralEnabled()) return null;
	const rows = await query(
		`
    SELECT Valor AS idSector, Descripcion AS descripcion
    FROM \`imSectores\`
    WHERE Valor = ? AND IdEmpresa = ?
    LIMIT 1
    `,
		[String(idSector), Number(idEmpresa)],
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
    INNER JOIN \`imSectores\` s
      ON s.Valor COLLATE ${COLLATE} = ps.idSector COLLATE ${COLLATE}
     AND s.IdEmpresa = ps.IdEmpresa
    WHERE ps.IdEmpresa = ? AND ps.idPersonal = ?
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
    LEFT JOIN \`imPersonal\` p ON ${JOIN_PERSONAL}
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
      AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) = '5'
      )
    LIMIT 1
    `,
		[normalizarUsername(username)],
	);
	return rows.length > 0;
}

async function obtenerEmpresaPorId(idEmpresa) {
	if (!isAuthCentralEnabled()) return null;
	const id = Number(idEmpresa);
	try {
		const rows = await query(
			`
    SELECT
      IDEMPRESA, DESCRIPCION, calle, calle_nro, Depto, piso, localidad, Provincia,
      Nro_CUIT, Nro_IngBrutos, IdTipoIVA, TEEmpresa, Email,
      DbServer, DbPort, DbInstance, DbName, DbUser, DbPassword, DbPasswordEnc,
      WhatsAppPhoneNumberId, WhatsAppWabaId, WhatsAppAccessTokenEnc,
      FileServerUrl
    FROM \`Empresas\`
    WHERE IDEMPRESA = ?
    LIMIT 1
    `,
			[id],
		);
		return rows[0] || null;
	} catch (e) {
		// Columna FileServerUrl aún no migrada
		if (!/fileserverurl/i.test(String(e.message || ''))) throw e;
		const rows = await query(
			`
    SELECT
      IDEMPRESA, DESCRIPCION, calle, calle_nro, Depto, piso, localidad, Provincia,
      Nro_CUIT, Nro_IngBrutos, IdTipoIVA, TEEmpresa, Email,
      DbServer, DbPort, DbInstance, DbName, DbUser, DbPassword, DbPasswordEnc,
      WhatsAppPhoneNumberId, WhatsAppWabaId, WhatsAppAccessTokenEnc
    FROM \`Empresas\`
    WHERE IDEMPRESA = ?
    LIMIT 1
    `,
			[id],
		);
		return rows[0] || null;
	}
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

/** Roles que no eligen sector en el login (misma regla que auth.service). */
function eximeRolSector(rol) {
	if (!rol) return false;
	const rolId = rol.RolId != null && rol.RolId !== '' ? Number(rol.RolId) : null;
	const rolNombre = String(rol.RolNombre || '').trim().toUpperCase();
	if (rolNombre === 'SUPER_ADMIN' || rolId === 5) return true;
	if (rolNombre === 'ADMIN' || rolId === 1) return true;
	if (Number(rol.Grupo) === 11) return true;
	return false;
}

/** Rol del usuario en auth central (MySQL), opcionalmente acotado a una empresa. */
async function obtenerRolDeUsuario(username, idEmpresa = null) {
	if (!isAuthCentralEnabled()) return null;
	const u = normalizarUsername(username);
	const params = [u];
	let filtroEmpresa = '';
	if (idEmpresa != null && idEmpresa !== '' && Number(idEmpresa) > 0) {
		filtroEmpresa = 'AND pw.IdEmpresa = ?';
		params.push(Number(idEmpresa));
	}
	const rows = await query(
		`
    SELECT
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      COALESCE(pw.Grupo, 0) AS Grupo
    FROM \`imPassword\` pw
    INNER JOIN \`imPersonalEmpresas\` pe ON ${JOIN_PERSONAL_EMPRESA}
    LEFT JOIN \`imPersonal\` p ON ${JOIN_PERSONAL}
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE ${USER_MATCH} = ?
    ${filtroEmpresa}
    ORDER BY pw.IdEmpresa
    LIMIT 1
    `,
		params,
	);
	return rows[0] || null;
}

/** true si el usuario es ADMIN / SUPER_ADMIN / Grupo 11 en Railway (sin consultar SQL físico). */
async function eximeSectorPorUsername(username, idEmpresa = null) {
	if (!isAuthCentralEnabled()) return false;
	if (await esSuperAdmin(username)) return true;

	const id =
		idEmpresa != null && idEmpresa !== '' && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0
			? Number(idEmpresa)
			: null;

	if (id) {
		const rol = await obtenerRolDeUsuario(username, id);
		return eximeRolSector(rol);
	}

	const empresas = await descubrirEmpresas(username);
	for (const e of empresas.slice(0, 5)) {
		const rol = await obtenerRolDeUsuario(username, e.idEmpresa);
		if (eximeRolSector(rol)) return true;
	}
	return false;
}

/** Normaliza fila de rol desde MySQL (Grupo 11 legacy → ADMIN). */
function mapRolDesdeFila(row) {
	if (!row) return null;
	let idRol = row.RolId != null && row.RolId !== '' ? Number(row.RolId) : null;
	let nombre = String(row.RolNombre || row.Nombre || '').trim();
	const nivel = row.Nivel != null ? Number(row.Nivel) : 0;
	if (!idRol && Number(row.Grupo) === 11) {
		idRol = 1;
		nombre = 'ADMIN';
	}
	if (idRol == null || !Number.isFinite(idRol)) return null;
	return {
		idRol,
		nombre,
		nivel,
		IdRol: idRol,
		Nombre: nombre,
		Descripcion: String(row.Descripcion || '').trim(),
		Nivel: nivel,
		Activo: true,
	};
}

/** Rol de un personal en una empresa (catálogo global Railway + imPersonal.Rol). */
async function obtenerRolDeValorPersonal(idEmpresa, valorPersonal) {
	const roles = await listarRolesDeValorPersonal(idEmpresa, valorPersonal);
	if (!roles.length) return null;
	const principal = roles.find((r) => r.EsPrincipal) || roles[0];
	return principal;
}

let _personalRolesTableReady = false;

async function ensurePersonalRolesTable() {
	if (_personalRolesTableReady || !isAuthCentralEnabled()) return;
	await query(`
    CREATE TABLE IF NOT EXISTS \`imPersonalRoles\` (
      \`IdEmpresa\` INT NOT NULL,
      \`Valor\` INT NOT NULL,
      \`IdRol\` INT NOT NULL,
      \`EsPrincipal\` TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (\`IdEmpresa\`, \`Valor\`, \`IdRol\`),
      KEY \`IX_imPersonalRoles_Rol\` (\`IdRol\`),
      KEY \`IX_imPersonalRoles_Personal\` (\`IdEmpresa\`, \`Valor\`, \`EsPrincipal\`)
    )
  `);
	_personalRolesTableReady = true;
}

/**
 * Lista todos los roles de un personal (imPersonalRoles + fallback imPersonal.Rol).
 * @returns {Promise<Array<{idRol:number,nombre:string,nivel:number,EsPrincipal:boolean,IdRol:number,Nombre:string,...}>>}
 */
async function listarRolesDeValorPersonal(idEmpresa, valorPersonal) {
	if (!isAuthCentralEnabled()) return [];
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	if (!Number.isFinite(emp) || emp <= 0 || !Number.isFinite(vp)) return [];

	await ensurePersonalRolesTable();

	const rows = await query(
		`
    SELECT
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      r.Descripcion AS Descripcion,
      r.Nivel AS Nivel,
      pr.EsPrincipal AS EsPrincipal
    FROM \`imPersonalRoles\` pr
    INNER JOIN \`imRoles\` r ON r.IdRol = pr.IdRol AND r.Activo = 1
    WHERE pr.IdEmpresa = ? AND pr.Valor = ?
    ORDER BY pr.EsPrincipal DESC, r.Nivel DESC, r.Nombre ASC
    `,
		[emp, vp],
	);

	if (rows.length) {
		return rows
			.map((row) => {
				const mapped = mapRolDesdeFila(row);
				if (!mapped) return null;
				const esPrincipal = Number(row.EsPrincipal) === 1;
				return { ...mapped, EsPrincipal: esPrincipal, esPrincipal };
			})
			.filter(Boolean);
	}

	// Fallback: rol único en imPersonal.Rol (migración / compatibilidad)
	const legacy = await query(
		`
    SELECT
      r.IdRol AS RolId,
      r.Nombre AS RolNombre,
      r.Descripcion AS Descripcion,
      r.Nivel AS Nivel,
      COALESCE(pw.Grupo, 0) AS Grupo
    FROM \`imPersonal\` p
    LEFT JOIN \`imPassword\` pw ON ${JOIN_PERSONAL}
    LEFT JOIN \`imRoles\` r ON ${ROL_JOIN} AND r.Activo = 1
    WHERE p.IdEmpresa = ? AND p.Valor = ?
    LIMIT 1
    `,
		[emp, vp],
	);
	const mapped = mapRolDesdeFila(legacy[0] || null);
	if (!mapped) return [];

	// Backfill silencioso a imPersonalRoles
	try {
		await query(
			`
      INSERT IGNORE INTO \`imPersonalRoles\` (IdEmpresa, Valor, IdRol, EsPrincipal)
      VALUES (?, ?, ?, 1)
      `,
			[emp, vp, mapped.idRol],
		);
	} catch (e) {
		console.warn('[authCentral] backfill imPersonalRoles:', e.message);
	}

	return [{ ...mapped, EsPrincipal: true, esPrincipal: true }];
}

/**
 * Reemplaza los roles de un personal. Mantiene imPersonal.Rol = principal.
 * @param {number} idEmpresa
 * @param {number} valorPersonal
 * @param {number[]} idRoles
 * @param {number|null} [idRolPrincipal]
 */
async function asignarRolesDeValorPersonal(idEmpresa, valorPersonal, idRoles, idRolPrincipal) {
	if (!isAuthCentralEnabled()) return [];
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	if (!Number.isFinite(emp) || emp <= 0 || !Number.isFinite(vp)) {
		const e = new Error('idEmpresa o valorPersonal inválido');
		e.statusCode = 400;
		throw e;
	}

	const ids = [
		...new Set(
			(Array.isArray(idRoles) ? idRoles : [])
				.map((x) => Number(x))
				.filter((n) => Number.isFinite(n) && n > 0),
		),
	];

	const [pwRows, personalRows] = await Promise.all([
		query(
			`SELECT ValorPersonal FROM \`imPassword\` WHERE IdEmpresa = ? AND ValorPersonal = ? LIMIT 1`,
			[emp, vp],
		),
		query(`SELECT Valor FROM \`imPersonal\` WHERE IdEmpresa = ? AND Valor = ? LIMIT 1`, [emp, vp]),
	]);
	if (!pwRows.length && !personalRows.length) {
		const otrasEmpresas = await query(
			`SELECT DISTINCT IdEmpresa FROM \`imPersonal\` WHERE Valor = ?`,
			[vp],
		);
		if (otrasEmpresas.length) {
			const ids = otrasEmpresas.map((r) => r.IdEmpresa).join(', ');
			const e = new Error(
				`El personal ${vp} está en Railway con IdEmpresa ${ids}, pero la sesión usa empresa ${emp}. Volvé a iniciar sesión en la empresa correcta.`,
			);
			e.statusCode = 409;
			throw e;
		}
		const e = new Error('Personal no encontrado');
		e.statusCode = 404;
		throw e;
	}

	await ensurePersonalRolesTable();

	let principal =
		idRolPrincipal != null && Number.isFinite(Number(idRolPrincipal))
			? Number(idRolPrincipal)
			: null;
	if (principal != null && !ids.includes(principal)) {
		ids.push(principal);
	}
	if (principal == null && ids.length) principal = ids[0];
	if (ids.length === 0) principal = null;

	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		await conn.query(`DELETE FROM \`imPersonalRoles\` WHERE IdEmpresa = ? AND Valor = ?`, [
			emp,
			vp,
		]);
		for (const idRol of ids) {
			await conn.query(
				`INSERT INTO \`imPersonalRoles\` (IdEmpresa, Valor, IdRol, EsPrincipal) VALUES (?, ?, ?, ?)`,
				[emp, vp, idRol, idRol === principal ? 1 : 0],
			);
		}
		const rolValor = principal != null ? String(principal) : null;
		const [updResult] = await conn.query(
			`UPDATE \`imPersonal\` SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?`,
			[rolValor, emp, vp],
		);
		if (!updResult.affectedRows) {
			await conn.query(`INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol) VALUES (?, ?, ?)`, [
				emp,
				vp,
				rolValor,
			]);
		}
		await conn.commit();
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}

	return listarRolesDeValorPersonal(emp, vp);
}

/**
 * Persiste imPersonal.Rol en Railway (auth central) y sincroniza imPersonalRoles (un solo rol).
 * @param {number} idEmpresa
 * @param {number} valorPersonal
 * @param {number|null} idRol - null para limpiar
 */
async function asignarRolDeValorPersonal(idEmpresa, valorPersonal, idRol) {
	const rolValor =
		idRol == null || idRol === '' || Number(idRol) === 0 ? null : Number(idRol);
	const ids = rolValor == null ? [] : [rolValor];
	const roles = await asignarRolesDeValorPersonal(idEmpresa, valorPersonal, ids, rolValor);
	return roles[0] || null;
}

async function obtenerRolPorId(idRol) {
	if (!isAuthCentralEnabled() || idRol == null) return null;
	const rows = await query(
		`
    SELECT IdRol AS RolId, Nombre AS RolNombre, Descripcion, Nivel
    FROM \`imRoles\`
    WHERE IdRol = ? AND Activo = 1
    LIMIT 1
    `,
		[Number(idRol)],
	);
	return mapRolDesdeFila(rows[0] || null);
}

async function listarRolesCatalogo() {
	if (!isAuthCentralEnabled()) return [];
	const rows = await query(
		`
    SELECT IdRol AS RolId, Nombre AS RolNombre, Descripcion, Nivel
    FROM \`imRoles\`
    WHERE Activo = 1 AND UPPER(TRIM(Nombre)) <> 'SUPER_ADMIN'
    ORDER BY Nivel DESC, Nombre ASC
    `,
	);
	return rows.map((r) => mapRolDesdeFila(r)).filter(Boolean);
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
	obtenerRolDeUsuario,
	eximeSectorPorUsername,
	obtenerRolDeValorPersonal,
	listarRolesDeValorPersonal,
	asignarRolesDeValorPersonal,
	asignarRolDeValorPersonal,
	obtenerRolPorId,
	listarRolesCatalogo,
	mapRolDesdeFila,
};
