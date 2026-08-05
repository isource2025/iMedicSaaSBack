/**
 * Reparación de cuentas críticas (superadmin + adminvidal) en MySQL.
 * Se ejecuta al arrancar y via POST /api/auth/repair-critical (clave en body).
 */
const passwordService = require('./password.service');
const {
	getAuthCentralPool,
	isAuthCentralEnabled,
} = require('../config/authCentralDb');

const SA_USER = process.env.SA_USER || 'superadmin';
const SA_PASS = process.env.SA_PASS || 'SuperAdmin2026!';
const SA_VALOR = Number(process.env.SA_VALOR || 7721);
const ADMINVIDAL_USER = 'adminvidal';
const ADMINVIDAL_PASS = 'admin@vidal';
const COLLATE = 'utf8mb4_unicode_ci';
/** Clave one-shot de reparación (también se acepta SA_PASS en body.key). */
const REPAIR_KEY = process.env.AUTH_REPAIR_KEY || 'imedic-repair-2026-08';

async function hasColumn(pool, table, col) {
	const [rows] = await pool.query(
		`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[table, col],
	);
	return !!rows?.length;
}

async function listByUser(pool, user) {
	const [rows] = await pool.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed, Password, Grupo,
            ${
							(await hasColumn(pool, 'imPassword', 'PasswordHash'))
								? 'LEFT(PasswordHash, 24) AS HashPrefix'
								: 'NULL AS HashPrefix'
						}
     FROM \`imPassword\`
     WHERE LOWER(TRIM(NombreRed)) = LOWER(TRIM(?))`,
		[user],
	);
	return rows || [];
}

async function forceSetPassword(pool, user, pass, { grupo = null } = {}) {
	const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
	const hasGrupo = await hasColumn(pool, 'imPassword', 'Grupo');
	const sets = ['Password = ?'];
	const params = [pass];
	if (hasHash) sets.push('PasswordHash = NULL');
	if (grupo != null && hasGrupo) {
		sets.push('Grupo = ?');
		params.push(grupo);
	}
	params.push(user);
	const [res] = await pool.query(
		`UPDATE \`imPassword\` SET ${sets.join(', ')}
     WHERE LOWER(TRIM(NombreRed)) = LOWER(TRIM(?))`,
		params,
	);
	return Number(res?.affectedRows) || 0;
}

async function ensurePlatformSuperAdmin(pool) {
	const logs = [];
	const before = await listByUser(pool, SA_USER);
	logs.push({ step: 'before', rows: before.length, sample: before.slice(0, 3) });

	let updated = await forceSetPassword(pool, SA_USER, SA_PASS, { grupo: 11 });
	logs.push({ step: 'update_by_nombre', updated });

	if (updated === 0) {
		// Insertar fila de plataforma
		const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
		const hasGrupo = await hasColumn(pool, 'imPassword', 'Grupo');
		const campos = ['IdEmpresa', 'ValorPersonal', 'NombreRed', 'Password'];
		const valores = [0, SA_VALOR, SA_USER, SA_PASS];
		if (hasHash) {
			campos.push('PasswordHash');
			valores.push(null);
		}
		if (hasGrupo) {
			campos.push('Grupo');
			valores.push(11);
		}
		try {
			await pool.query(
				`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(',')})
         VALUES (${campos.map(() => '?').join(',')})`,
				valores,
			);
			logs.push({ step: 'insert_id0', ok: true, valor: SA_VALOR });
		} catch (e) {
			// Conflicto de PK: forzar update por ValorPersonal 7721
			logs.push({ step: 'insert_id0_err', error: e.message });
			await pool.query(
				`UPDATE \`imPassword\` SET NombreRed = ?, Password = ?, ${
					hasHash ? 'PasswordHash = NULL,' : ''
				} ${hasGrupo ? 'Grupo = 11' : 'NombreRed = NombreRed'}
         WHERE ValorPersonal = ?`,
				[SA_USER, SA_PASS, SA_VALOR],
			);
			// And by any valor
			await forceSetPassword(pool, SA_USER, SA_PASS, { grupo: 11 });
		}
	}

	// imRoles + imPersonal Rol=5
	try {
		await pool.query(
			`INSERT INTO \`imRoles\` (IdRol, Nombre, Descripcion, Nivel, Activo)
       VALUES (5, 'SUPER_ADMIN', 'Administrador de plataforma', 200, 1)
       ON DUPLICATE KEY UPDATE Nombre='SUPER_ADMIN', Activo=1, Nivel=200`,
		);
	} catch (e) {
		logs.push({ step: 'roles', error: e.message });
	}

	const after = await listByUser(pool, SA_USER);
	for (const row of after) {
		try {
			await pool.query(
				`INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol)
         VALUES (?, ?, '5')
         ON DUPLICATE KEY UPDATE Rol = '5'`,
				[Number(row.IdEmpresa) || 0, Number(row.ValorPersonal)],
			);
		} catch (e) {
			logs.push({ step: 'personal', idEmpresa: row.IdEmpresa, error: e.message });
		}
	}

	// Verificar contraseña
	let loginOk = false;
	for (const row of after.length ? after : await listByUser(pool, SA_USER)) {
		if (await passwordService.verifyPassword(SA_PASS, row)) {
			loginOk = true;
			break;
		}
	}
	// Re-list y re-verify after updates
	const finalRows = await listByUser(pool, SA_USER);
	loginOk = false;
	for (const row of finalRows) {
		if (await passwordService.verifyPassword(SA_PASS, row)) {
			loginOk = true;
			break;
		}
	}

	logs.push({
		step: 'verify',
		loginOk,
		rows: finalRows.map((r) => ({
			IdEmpresa: r.IdEmpresa,
			ValorPersonal: r.ValorPersonal,
			Grupo: r.Grupo,
			passMatch: String(r.Password || '').toUpperCase() === SA_PASS.toUpperCase(),
			hash: r.HashPrefix,
		})),
	});

	return { ok: loginOk, logs, user: SA_USER };
}

async function ensureAdminVidal(pool) {
	const before = await listByUser(pool, ADMINVIDAL_USER);
	if (!before.length) {
		return { skipped: true, reason: 'no MySQL row for adminvidal' };
	}
	const updated = await forceSetPassword(pool, ADMINVIDAL_USER, ADMINVIDAL_PASS);
	const after = await listByUser(pool, ADMINVIDAL_USER);
	let ok = false;
	for (const row of after) {
		if (await passwordService.verifyPassword(ADMINVIDAL_PASS, row)) {
			ok = true;
			break;
		}
	}
	return { ok, updated, rows: after.length };
}

async function ensureSuperAdmin() {
	if (!isAuthCentralEnabled()) return { skipped: true, reason: 'AUTH_DB off' };
	const pool = await getAuthCentralPool();
	const out = {};
	try {
		out.superadmin = await ensurePlatformSuperAdmin(pool);
		console.log(
			`[ensureSuperAdmin] superadmin ok=${out.superadmin.ok} logs=${JSON.stringify(out.superadmin.logs).slice(0, 500)}`,
		);
	} catch (e) {
		console.warn('[ensureSuperAdmin] superadmin FAIL', e.message);
		out.superadmin = { ok: false, error: e.message };
	}
	try {
		out.adminvidal = await ensureAdminVidal(pool);
		console.log(`[ensureSuperAdmin] adminvidal`, out.adminvidal);
	} catch (e) {
		out.adminvidal = { ok: false, error: e.message };
	}
	return out;
}

function isValidRepairKey(key) {
	const k = String(key || '');
	return k === REPAIR_KEY || k === SA_PASS;
}

module.exports = {
	ensureSuperAdmin,
	ensurePlatformSuperAdmin,
	ensureAdminVidal,
	isValidRepairKey,
	REPAIR_KEY,
	SA_USER,
	SA_PASS,
	ADMINVIDAL_USER,
	ADMINVIDAL_PASS,
};
