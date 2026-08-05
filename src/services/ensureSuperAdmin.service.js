/**
 * Asegura cuentas críticas en MySQL tras sync/import:
 * - superadmin (plataforma) → SuperAdmin2026! (o SA_PASS)
 * - adminvidal (si existe) → admin@vidal
 */
const passwordService = require('./password.service');
const {
	getAuthCentralPool,
	isAuthCentralEnabled,
} = require('../config/authCentralDb');

const SA_USER = process.env.SA_USER || 'superadmin';
const SA_PASS = process.env.SA_PASS || 'SuperAdmin2026!';
const SA_VALOR = Number(process.env.SA_VALOR || 1000001);
const ID_ROL_SUPER = 5;
const COLLATE = 'utf8mb4_unicode_ci';

const ADMINVIDAL_USER = 'adminvidal';
const ADMINVIDAL_PASS = 'admin@vidal';

async function colSet(pool, table) {
	const [rows] = await pool.query(
		`SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
		[table],
	);
	return new Set((rows || []).map((r) => String(r.col)));
}

async function puedeLoguear(pool, username, password, { plataforma = false } = {}) {
	const [rows] = await pool.query(
		`
    SELECT pw.*
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p
      ON p.Valor = pw.ValorPersonal AND (p.IdEmpresa = pw.IdEmpresa OR (COALESCE(p.IdEmpresa,0)=0 AND COALESCE(pw.IdEmpresa,0)=0))
    LEFT JOIN \`imRoles\` r
      ON CAST(r.IdRol AS CHAR) COLLATE ${COLLATE} = TRIM(COALESCE(p.Rol, '')) COLLATE ${COLLATE}
     AND r.Activo = 1
    WHERE LOWER(TRIM(COALESCE(pw.NombreRed, ''))) COLLATE ${COLLATE} = LOWER(TRIM(?)) COLLATE ${COLLATE}
      ${
				plataforma
					? `AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) COLLATE ${COLLATE} = '5'
        OR COALESCE(pw.Grupo, 0) = 11
      )`
					: ''
			}
    LIMIT 10
    `,
		[username],
	);
	if (!rows?.length) return false;
	for (const row of rows) {
		if (await passwordService.verifyPassword(password, row)) return true;
	}
	return false;
}

async function setPasswordByNombreRed(pool, nombreRed, plain, { grupo = null } = {}) {
	const cols = await colSet(pool, 'imPassword');
	const sets = ['Password = ?'];
	const params = [String(plain)];
	if (cols.has('PasswordHash')) {
		sets.push('PasswordHash = NULL');
	}
	if (grupo != null && cols.has('Grupo')) {
		sets.push('Grupo = ?');
		params.push(Number(grupo));
	}
	params.push(String(nombreRed));
	const [res] = await pool.query(
		`UPDATE \`imPassword\`
     SET ${sets.join(', ')}
     WHERE LOWER(TRIM(NombreRed)) = LOWER(TRIM(?))`,
		params,
	);
	return Number(res?.affectedRows) || 0;
}

async function ensureRol(pool) {
	const tables = await colSet(pool, 'imRoles');
	if (!tables.size && !(await tableExists(pool, 'imRoles'))) return;
	await pool.query(
		`INSERT INTO \`imRoles\` (IdRol, Nombre, Descripcion, Nivel, Activo)
     VALUES (?, 'SUPER_ADMIN', 'Administrador de plataforma', 200, 1)
     ON DUPLICATE KEY UPDATE Nombre = 'SUPER_ADMIN', Nivel = 200, Activo = 1`,
		[ID_ROL_SUPER],
	);
}

async function tableExists(pool, table) {
	const [rows] = await pool.query(
		`SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
		[table],
	);
	return !!rows?.length;
}

async function insertPlatformSuperAdmin(pool) {
	const cols = await colSet(pool, 'imPassword');
	const [exist] = await pool.query(
		`SELECT ValorPersonal, IdEmpresa FROM \`imPassword\`
     WHERE LOWER(TRIM(NombreRed)) = LOWER(?) LIMIT 1`,
		[SA_USER],
	);
	let valor = SA_VALOR;
	let idEmpresa = 0;
	if (exist.length) {
		valor = Number(exist[0].ValorPersonal) || SA_VALOR;
		idEmpresa = Number(exist[0].IdEmpresa);
		if (!Number.isFinite(idEmpresa)) idEmpresa = 0;
	} else {
		const [maxRow] = await pool.query(
			`SELECT COALESCE(MAX(ValorPersonal), 0) AS maxv FROM \`imPassword\``,
		);
		const maxv = Number(maxRow[0]?.maxv) || 0;
		if (maxv >= valor) valor = maxv + 1;
	}

	const hash = cols.has('PasswordHash')
		? await passwordService.hashPassword(SA_PASS)
		: null;

	// Actualizar todas las filas con ese NombreRed
	const n = await setPasswordByNombreRed(pool, SA_USER, SA_PASS, { grupo: 11 });
	if (n > 0) {
		// Asegurar Rol en imPersonal
		if (await tableExists(pool, 'imPersonal')) {
			await pool
				.query(
					`UPDATE \`imPersonal\` SET Rol = '5'
           WHERE Valor = ?`,
					[valor],
				)
				.catch(() => {});
			await pool
				.query(
					`INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol, ApellidoNombre)
           VALUES (0, ?, '5', 'Super, Admin Plataforma')
           ON DUPLICATE KEY UPDATE Rol = '5'`,
					[valor],
				)
				.catch(() => {});
		}
		return { valor, idEmpresa, updated: n };
	}

	// Insert plataforma IdEmpresa=0
	const campos = ['IdEmpresa', 'ValorPersonal', 'NombreRed', 'Password'];
	const valores = [0, valor, SA_USER, SA_PASS];
	if (cols.has('PasswordHash')) {
		campos.push('PasswordHash');
		valores.push(hash);
	}
	if (cols.has('Grupo')) {
		campos.push('Grupo');
		valores.push(11);
	}
	if (cols.has('Nombres')) {
		campos.push('Nombres');
		valores.push('Admin');
	}
	if (cols.has('Apellido')) {
		campos.push('Apellido');
		valores.push('Super');
	}

	await pool.query(
		`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${campos.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE
       NombreRed = VALUES(NombreRed),
       Password = VALUES(Password),
       ${cols.has('PasswordHash') ? 'PasswordHash = VALUES(PasswordHash),' : ''}
       ${cols.has('Grupo') ? 'Grupo = 11' : 'NombreRed = VALUES(NombreRed)'}`,
		valores,
	);

	if (await tableExists(pool, 'imPersonal')) {
		await pool
			.query(
				`INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol, ApellidoNombre)
         VALUES (0, ?, '5', 'Super, Admin Plataforma')
         ON DUPLICATE KEY UPDATE Rol = '5'`,
				[valor],
			)
			.catch(() => {});
	}

	return { valor, idEmpresa: 0, inserted: true };
}

async function ensureSuperAdmin() {
	if (!isAuthCentralEnabled()) return { skipped: true, reason: 'AUTH_DB off' };
	const pool = await getAuthCentralPool();

	const results = { superadmin: null, adminvidal: null };

	try {
		await ensureRol(pool).catch(() => {});
		const okBefore = await puedeLoguear(pool, SA_USER, SA_PASS, { plataforma: true });
		if (okBefore) {
			results.superadmin = { ok: true, repaired: false };
		} else {
			const r = await insertPlatformSuperAdmin(pool);
			// Forzar password aunque el insert haya fallado parcialmente
			await setPasswordByNombreRed(pool, SA_USER, SA_PASS, { grupo: 11 });
			const okAfter = await puedeLoguear(pool, SA_USER, SA_PASS, { plataforma: true });
			// Si aún no: quitar hash y dejar solo legacy
			if (!okAfter) {
				await setPasswordByNombreRed(pool, SA_USER, SA_PASS, { grupo: 11 });
			}
			const ok = await puedeLoguear(pool, SA_USER, SA_PASS, { plataforma: true });
			results.superadmin = { ok, repaired: true, ...r };
			console.log(
				`[ensureSuperAdmin] superadmin ${ok ? 'OK' : 'FAIL'} valor=${r?.valor}`,
			);
		}
	} catch (e) {
		console.warn('[ensureSuperAdmin] superadmin error:', e.message);
		results.superadmin = { ok: false, error: e.message };
	}

	try {
		const [exists] = await pool.query(
			`SELECT COUNT(*) AS c FROM \`imPassword\`
       WHERE LOWER(TRIM(NombreRed)) = LOWER(?)`,
			[ADMINVIDAL_USER],
		);
		const c = Number(exists[0]?.c) || 0;
		if (c > 0) {
			const okBefore = await puedeLoguear(pool, ADMINVIDAL_USER, ADMINVIDAL_PASS);
			if (!okBefore) {
				const n = await setPasswordByNombreRed(pool, ADMINVIDAL_USER, ADMINVIDAL_PASS);
				const ok = await puedeLoguear(pool, ADMINVIDAL_USER, ADMINVIDAL_PASS);
				results.adminvidal = { ok, repaired: true, rows: n };
				console.log(
					`[ensureSuperAdmin] adminvidal ${ok ? 'OK' : 'FAIL'} rows=${n}`,
				);
			} else {
				results.adminvidal = { ok: true, repaired: false };
			}
		} else {
			results.adminvidal = { skipped: true, reason: 'no row in MySQL' };
		}
	} catch (e) {
		console.warn('[ensureSuperAdmin] adminvidal error:', e.message);
		results.adminvidal = { ok: false, error: e.message };
	}

	return results;
}

module.exports = {
	ensureSuperAdmin,
	puedeLoguear,
	setPasswordByNombreRed,
	SA_USER,
	SA_PASS,
	ADMINVIDAL_USER,
	ADMINVIDAL_PASS,
};
