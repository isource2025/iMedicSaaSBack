/**
 * Reparación de superadmin de plataforma (IdEmpresa=0) sin pisar cuentas de hospital.
 * También restaura adminvidal y libera filas hijacked (NombreRed=superadmin en tenant).
 */
const passwordService = require('./password.service');
const {
	getAuthCentralPool,
	isAuthCentralEnabled,
} = require('../config/authCentralDb');

const SA_USER = process.env.SA_USER || 'superadmin';
const SA_PASS = process.env.SA_PASS || 'SuperAdmin2026!';
const SA_VALOR = Number(process.env.SA_VALOR || 1000001);
const ADMINVIDAL_USER = 'adminvidal';
const ADMINVIDAL_PASS = 'admin@vidal';
const REPAIR_KEY = process.env.AUTH_REPAIR_KEY || 'imedic-repair-2026-08';

async function hasColumn(pool, table, col) {
	const [rows] = await pool.query(
		`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[table, col],
	);
	return !!rows?.length;
}

async function forceSetPassword(pool, user, pass, { grupo = null, onlyIdEmpresa = null } = {}) {
	const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
	const hasGrupo = await hasColumn(pool, 'imPassword', 'Grupo');
	const sets = ['Password = ?'];
	const params = [pass];
	if (hasHash) sets.push('PasswordHash = NULL');
	if (grupo != null && hasGrupo) {
		sets.push('Grupo = ?');
		params.push(grupo);
	}
	let where = `LOWER(TRIM(NombreRed)) = LOWER(TRIM(?))`;
	params.push(user);
	if (onlyIdEmpresa != null) {
		where += ` AND IdEmpresa = ?`;
		params.push(onlyIdEmpresa);
	}
	const [res] = await pool.query(
		`UPDATE \`imPassword\` SET ${sets.join(', ')} WHERE ${where}`,
		params,
	);
	return Number(res?.affectedRows) || 0;
}

/**
 * Si superadmin quedó en un ValorPersonal de hospital (IdEmpresa>0), devolver cuenta al físico.
 * Caso conocido: VP 7721 = CHAPARRO / 39860566 / 7721.
 */
async function restoreHijackedTenantSuperadmin(pool) {
	const logs = [];
	const [rows] = await pool.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed, Password, Grupo
     FROM \`imPassword\`
     WHERE LOWER(TRIM(NombreRed)) = 'superadmin' AND COALESCE(IdEmpresa, 0) > 0`,
	);
	for (const row of rows || []) {
		const vp = Number(row.ValorPersonal);
		const emp = Number(row.IdEmpresa);
		// Restaurar desde mapeo conocido + heurística: password = ValorPersonal si era patrón Clarion
		if (vp === 7721 && emp === 1) {
			const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
			await pool.query(
				`UPDATE \`imPassword\`
         SET NombreRed = '39860566', Password = '7721', Grupo = 0
           ${hasHash ? ', PasswordHash = NULL' : ''}
         WHERE IdEmpresa = 1 AND ValorPersonal = 7721`,
			);
			logs.push({ restored: '7721→39860566/7721' });
		} else {
			// Quitar nombre superadmin del tenant para no chocar con plataforma
			await pool.query(
				`UPDATE \`imPassword\` SET NombreRed = CONCAT('user_', ValorPersonal), Grupo = 0
         WHERE IdEmpresa = ? AND ValorPersonal = ?`,
				[emp, vp],
			);
			logs.push({ stripped: { emp, vp } });
		}
	}
	return logs;
}

async function ensurePlatformSuperAdmin(pool) {
	const logs = [];
	logs.push({ hijack: await restoreHijackedTenantSuperadmin(pool) });

	const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
	const hasGrupo = await hasColumn(pool, 'imPassword', 'Grupo');

	// ¿Ya existe en plataforma IdEmpresa=0?
	const [plat] = await pool.query(
		`SELECT ValorPersonal FROM \`imPassword\`
     WHERE COALESCE(IdEmpresa, 0) = 0 AND LOWER(TRIM(NombreRed)) = LOWER(?)
     LIMIT 1`,
		[SA_USER],
	);

	let valor = SA_VALOR;
	if (plat.length) {
		valor = Number(plat[0].ValorPersonal) || SA_VALOR;
		await forceSetPassword(pool, SA_USER, SA_PASS, { grupo: 11, onlyIdEmpresa: 0 });
		logs.push({ step: 'update_platform_0', valor });
	} else {
		// Insert limpio de plataforma
		const campos = ['IdEmpresa', 'ValorPersonal', 'NombreRed', 'Password'];
		const valores = [0, valor, SA_USER, SA_PASS];
		if (hasHash) {
			campos.push('PasswordHash');
			valores.push(null);
		}
		if (hasGrupo) {
			campos.push('Grupo');
			valores.push(11);
		}
		if (await hasColumn(pool, 'imPassword', 'Nombres')) {
			campos.push('Nombres');
			valores.push('Admin');
		}
		if (await hasColumn(pool, 'imPassword', 'Apellido')) {
			campos.push('Apellido');
			valores.push('Super');
		}
		if (await hasColumn(pool, 'imPassword', 'CodOperador')) {
			campos.push('CodOperador');
			valores.push(999);
		}
		try {
			await pool.query(
				`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(',')})
         VALUES (${campos.map(() => '?').join(',')})`,
				valores,
			);
			logs.push({ step: 'insert_platform_0', valor });
		} catch (e) {
			// PK ocupada: reasignar valor
			const [maxRow] = await pool.query(
				`SELECT COALESCE(MAX(ValorPersonal), 0)+1 AS v FROM \`imPassword\``,
			);
			valor = Number(maxRow[0]?.v) || SA_VALOR + 1;
			valores[1] = valor;
			await pool.query(
				`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(',')})
         VALUES (${campos.map(() => '?').join(',')})`,
				valores,
			);
			logs.push({ step: 'insert_platform_0_retry', valor, prevError: e.message });
		}
	}

	// Rol SUPER_ADMIN + imPersonal plataforma
	try {
		await pool.query(
			`INSERT INTO \`imRoles\` (IdRol, Nombre, Descripcion, Nivel, Activo)
       VALUES (5, 'SUPER_ADMIN', 'Administrador de plataforma', 200, 1)
       ON DUPLICATE KEY UPDATE Nombre='SUPER_ADMIN', Activo=1, Nivel=200`,
		);
	} catch (e) {
		logs.push({ step: 'roles', error: e.message });
	}

	const personalCols = await (async () => {
		const [c] = await pool.query(
			`SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imPersonal'`,
		);
		return new Set((c || []).map((r) => String(r.col)));
	})();

	if (personalCols.size) {
		const pCampos = ['IdEmpresa', 'Valor'];
		const pVals = [0, valor];
		if (personalCols.has('Rol')) {
			pCampos.push('Rol');
			pVals.push('5');
		}
		if (personalCols.has('ApellidoNombre')) {
			pCampos.push('ApellidoNombre');
			pVals.push('Super, Admin Plataforma');
		}
		if (personalCols.has('Matricula')) {
			pCampos.push('Matricula');
			pVals.push(valor);
		}
		try {
			await pool.query(
				`INSERT INTO \`imPersonal\` (${pCampos.map((c) => `\`${c}\``).join(',')})
         VALUES (${pCampos.map(() => '?').join(',')})
         ON DUPLICATE KEY UPDATE Rol = '5'`,
				pVals,
			);
			logs.push({ step: 'personal_ok', valor });
		} catch (e) {
			logs.push({ step: 'personal_err', error: e.message });
			// Intento UPDATE solo rol
			await pool
				.query(`UPDATE \`imPersonal\` SET Rol = '5' WHERE IdEmpresa = 0 AND Valor = ?`, [valor])
				.catch(() => {});
		}
	}

	const [check] = await pool.query(
		`SELECT pw.IdEmpresa, pw.ValorPersonal, pw.NombreRed, pw.Password, pw.Grupo, p.Rol,
            r.Nombre AS RolNombre
     FROM \`imPassword\` pw
     LEFT JOIN \`imPersonal\` p ON p.Valor = pw.ValorPersonal AND p.IdEmpresa = pw.IdEmpresa
     LEFT JOIN \`imRoles\` r ON CAST(r.IdRol AS CHAR) = TRIM(COALESCE(p.Rol,'')) AND r.Activo = 1
     WHERE COALESCE(pw.IdEmpresa,0) = 0 AND LOWER(TRIM(pw.NombreRed)) = LOWER(?)
     LIMIT 1`,
		[SA_USER],
	);
	const row = check[0];
	const passOk = row && String(row.Password || '').toUpperCase() === SA_PASS.toUpperCase();
	const roleOk =
		row &&
		(String(row.RolNombre || '').toUpperCase() === 'SUPER_ADMIN' ||
			String(row.Rol || '') === '5' ||
			Number(row.Grupo) === 11);
	const loginOk = !!(row && passOk);

	logs.push({
		step: 'verify',
		loginOk,
		roleOk,
		row: row
			? {
					IdEmpresa: row.IdEmpresa,
					ValorPersonal: row.ValorPersonal,
					Rol: row.Rol,
					RolNombre: row.RolNombre,
					Grupo: row.Grupo,
					passOk,
				}
			: null,
	});

	return { ok: loginOk, logs, user: SA_USER, valor };
}

async function ensureAdminVidal(pool) {
	const [exists] = await pool.query(
		`SELECT COUNT(*) AS c FROM \`imPassword\` WHERE LOWER(TRIM(NombreRed)) = LOWER(?)`,
		[ADMINVIDAL_USER],
	);
	if (!Number(exists[0]?.c)) {
		return { skipped: true, reason: 'no MySQL row' };
	}
	const updated = await forceSetPassword(pool, ADMINVIDAL_USER, ADMINVIDAL_PASS);
	return { ok: true, updated };
}

async function ensureSuperAdmin() {
	if (!isAuthCentralEnabled()) return { skipped: true, reason: 'AUTH_DB off' };
	const pool = await getAuthCentralPool();
	const out = {};
	try {
		out.superadmin = await ensurePlatformSuperAdmin(pool);
		console.log('[ensureSuperAdmin]', JSON.stringify(out.superadmin).slice(0, 600));
	} catch (e) {
		console.warn('[ensureSuperAdmin] FAIL', e.message);
		out.superadmin = { ok: false, error: e.message };
	}
	try {
		out.adminvidal = await ensureAdminVidal(pool);
	} catch (e) {
		out.adminvidal = { ok: false, error: e.message };
	}
	// Restaurar médico 39860566 por si aún está roto el login
	try {
		const [doc] = await pool.query(
			`SELECT NombreRed FROM \`imPassword\` WHERE IdEmpresa=1 AND ValorPersonal=7721 LIMIT 1`,
		);
		if (doc[0] && String(doc[0].NombreRed).toLowerCase() === 'superadmin') {
			await pool.query(
				`UPDATE \`imPassword\` SET NombreRed='39860566', Password='7721', Grupo=0,
           PasswordHash=NULL WHERE IdEmpresa=1 AND ValorPersonal=7721`,
			);
			out.restored7721 = true;
		}
	} catch {
		/* PasswordHash puede no existir */
		try {
			await pool.query(
				`UPDATE \`imPassword\` SET NombreRed='39860566', Password='7721', Grupo=0
         WHERE IdEmpresa=1 AND ValorPersonal=7721 AND LOWER(TRIM(NombreRed))='superadmin'`,
			);
		} catch {
			/* ignore */
		}
	}
	return out;
}

function isValidRepairKey(key) {
	const k = String(key || '');
	return k === REPAIR_KEY || k === SA_PASS;
}

module.exports = {
	ensureSuperAdmin,
	isValidRepairKey,
	REPAIR_KEY,
	SA_USER,
	SA_PASS,
	ADMINVIDAL_USER,
	ADMINVIDAL_PASS,
};
