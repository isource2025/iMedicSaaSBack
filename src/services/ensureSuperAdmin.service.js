/**
 * Superadmin de plataforma (MySQL IdEmpresa=0 + rango de IDs reservado).
 * Nunca modifica filas de hospital (IdEmpresa>0).
 */
const passwordService = require('./password.service');
const {
	getAuthCentralPool,
	isAuthCentralEnabled,
} = require('../config/authCentralDb');
const {
	PLATFORM_EMPRESA_ID,
	SA_USER,
	SA_PASS,
	SA_VALOR,
	isReservedUsername,
} = require('../config/tenantIdentity');

const ADMINVIDAL_USER = 'adminvidal';
const ADMINVIDAL_PASS = 'admin@vidal';
const REPAIR_KEY = process.env.AUTH_REPAIR_KEY || 'imedic-repair-2026-08';
const COLLATE = 'utf8mb4_unicode_ci';

async function hasColumn(pool, table, col) {
	const [rows] = await pool.query(
		`SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[table, col],
	);
	return !!rows?.length;
}

/** Libera cuentas de tenant que usurparon el username de plataforma. */
async function liberarUsernameReservadoEnTenants(pool) {
	const logs = [];
	const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
	const [rows] = await pool.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed
     FROM \`imPassword\`
     WHERE COALESCE(IdEmpresa, 0) > 0
       AND LOWER(TRIM(NombreRed)) COLLATE ${COLLATE} = LOWER(?) COLLATE ${COLLATE}`,
		[SA_USER],
	);
	for (const row of rows || []) {
		const vp = Number(row.ValorPersonal);
		const emp = Number(row.IdEmpresa);
		// Restaurar caso conocido 7721 hospital Vidal
		if (emp === 1 && vp === 7721) {
			await pool.query(
				`UPDATE \`imPassword\`
         SET NombreRed = '39860566', Password = '7721', Grupo = 0
         ${hasHash ? ', PasswordHash = NULL' : ''}
         WHERE IdEmpresa = 1 AND ValorPersonal = 7721`,
			);
			logs.push({ restored: '1/7721 → 39860566' });
		} else {
			await pool.query(
				`UPDATE \`imPassword\`
         SET NombreRed = CONCAT('u', ValorPersonal), Grupo = 0
         ${hasHash ? ', PasswordHash = NULL' : ''}
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
	logs.push({ freeTenants: await liberarUsernameReservadoEnTenants(pool) });

	const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
	const hasGrupo = await hasColumn(pool, 'imPassword', 'Grupo');

	const [plat] = await pool.query(
		`SELECT ValorPersonal FROM \`imPassword\`
     WHERE COALESCE(IdEmpresa, 0) = ?
       AND LOWER(TRIM(NombreRed)) COLLATE ${COLLATE} = LOWER(?) COLLATE ${COLLATE}
     LIMIT 1`,
		[PLATFORM_EMPRESA_ID, SA_USER],
	);

	let valor = SA_VALOR;
	if (plat.length) {
		valor = Number(plat[0].ValorPersonal) || SA_VALOR;
		const sets = ['Password = ?', 'NombreRed = ?'];
		const params = [SA_PASS, SA_USER];
		if (hasHash) sets.push('PasswordHash = NULL');
		if (hasGrupo) {
			sets.push('Grupo = 11');
		}
		params.push(PLATFORM_EMPRESA_ID, valor);
		await pool.query(
			`UPDATE \`imPassword\` SET ${sets.join(', ')}
       WHERE IdEmpresa = ? AND ValorPersonal = ?`,
			params,
		);
		logs.push({ step: 'update_platform', valor });
	} else {
		const campos = ['IdEmpresa', 'ValorPersonal', 'NombreRed', 'Password'];
		const valores = [PLATFORM_EMPRESA_ID, valor, SA_USER, SA_PASS];
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
		try {
			await pool.query(
				`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(',')})
         VALUES (${campos.map(() => '?').join(',')})`,
				valores,
			);
			logs.push({ step: 'insert_platform', valor });
		} catch (e) {
			const [maxRow] = await pool.query(
				`SELECT COALESCE(MAX(ValorPersonal), ?) + 1 AS v FROM \`imPassword\`
         WHERE COALESCE(IdEmpresa,0) = 0 AND ValorPersonal >= ?`,
				[SA_VALOR, SA_VALOR],
			);
			valor = Number(maxRow[0]?.v) || SA_VALOR + 1;
			valores[1] = valor;
			await pool.query(
				`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(',')})
         VALUES (${campos.map(() => '?').join(',')})`,
				valores,
			);
			logs.push({ step: 'insert_platform_retry', valor, err: e.message });
		}
	}

	try {
		const rolesCatalogo = [
			[1, 'ADMIN', 'Administrador del sistema', 100],
			[2, 'MEDICO', 'Médico / profesional de salud', 50],
			[3, 'ENFERMERO', 'Personal de enfermería', 40],
			[4, 'ADMINISTRATIVO', 'Personal administrativo', 20],
			[5, 'SUPER_ADMIN', 'Administrador de plataforma', 200],
			[6, 'CARGA_HC', 'Carga de adjuntos', 25],
		];
		for (const [id, nombre, desc, nivel] of rolesCatalogo) {
			await pool.query(
				`INSERT INTO \`imRoles\` (IdRol, Nombre, Descripcion, Nivel, Activo)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE Nombre=VALUES(Nombre), Descripcion=VALUES(Descripcion), Activo=1, Nivel=VALUES(Nivel)`,
				[id, nombre, desc, nivel],
			);
		}
	} catch (e) {
		logs.push({ step: 'roles', error: e.message });
	}

	// imPersonal de plataforma (mismo par IdEmpresa=0, Valor)
	const pCampos = ['IdEmpresa', 'Valor'];
	const pVals = [PLATFORM_EMPRESA_ID, valor];
	if (await hasColumn(pool, 'imPersonal', 'Rol')) {
		pCampos.push('Rol');
		pVals.push('5');
	}
	if (await hasColumn(pool, 'imPersonal', 'ApellidoNombre')) {
		pCampos.push('ApellidoNombre');
		pVals.push('Super, Admin Plataforma');
	}
	if (await hasColumn(pool, 'imPersonal', 'Matricula')) {
		pCampos.push('Matricula');
		pVals.push(valor);
	}
	try {
		const upds = [];
		if (pCampos.includes('Rol')) upds.push(`Rol = '5'`);
		if (pCampos.includes('ApellidoNombre')) upds.push(`ApellidoNombre = VALUES(ApellidoNombre)`);
		await pool.query(
			`INSERT INTO \`imPersonal\` (${pCampos.map((c) => `\`${c}\``).join(',')})
       VALUES (${pCampos.map(() => '?').join(',')})
       ${upds.length ? `ON DUPLICATE KEY UPDATE ${upds.join(', ')}` : ''}`,
			pVals,
		);
		logs.push({ step: 'personal_ok' });
	} catch (e) {
		logs.push({ step: 'personal_err', error: e.message });
	}

	const [check] = await pool.query(
		`SELECT pw.IdEmpresa, pw.ValorPersonal, pw.NombreRed, pw.Password, pw.Grupo, p.Rol
     FROM \`imPassword\` pw
     LEFT JOIN \`imPersonal\` p
       ON p.Valor = pw.ValorPersonal AND p.IdEmpresa = pw.IdEmpresa
     WHERE COALESCE(pw.IdEmpresa,0) = ?
       AND LOWER(TRIM(pw.NombreRed)) COLLATE ${COLLATE} = LOWER(?) COLLATE ${COLLATE}
     LIMIT 1`,
		[PLATFORM_EMPRESA_ID, SA_USER],
	);
	const row = check[0];
	const passOk =
		row && (await passwordService.verifyPassword(SA_PASS, row));
	logs.push({
		step: 'verify',
		loginOk: !!passOk,
		idEmpresa: row?.IdEmpresa,
		valor: row?.ValorPersonal,
		rol: row?.Rol,
	});
	return { ok: !!passOk, logs, user: SA_USER, valor };
}

async function ensureAdminVidal(pool) {
	const [rows] = await pool.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed, Nombres, Apellido, Grupo
     FROM \`imPassword\`
     WHERE COALESCE(IdEmpresa,0) > 0
       AND LOWER(TRIM(NombreRed)) COLLATE ${COLLATE} = LOWER(?) COLLATE ${COLLATE}`,
		[ADMINVIDAL_USER],
	);
	if (!rows?.length) return { skipped: true };

	const hasHash = await hasColumn(pool, 'imPassword', 'PasswordHash');
	const hasGrupo = await hasColumn(pool, 'imPassword', 'Grupo');
	const hasNombres = await hasColumn(pool, 'imPassword', 'Nombres');
	const hasApellido = await hasColumn(pool, 'imPassword', 'Apellido');
	const hasPersonalRol = await hasColumn(pool, 'imPersonal', 'Rol');
	const hasApellidoNombre = await hasColumn(pool, 'imPersonal', 'ApellidoNombre');

	const sets = ['Password = ?'];
	const params = [ADMINVIDAL_PASS];
	if (hasHash) sets.push('PasswordHash = NULL');
	// Grupo 11 = admin hospital (legacy Clarion)
	if (hasGrupo) sets.push('Grupo = 11');
	if (hasNombres) {
		sets.push(
			`Nombres = CASE
         WHEN Nombres IS NULL OR TRIM(Nombres) = '' OR Nombres REGEXP '^[0-9]+$'
         THEN 'Admin' ELSE Nombres END`,
		);
	}
	if (hasApellido) {
		sets.push(
			`Apellido = CASE
         WHEN Apellido IS NULL OR TRIM(Apellido) = '' OR Apellido REGEXP '^[0-9]+$'
         THEN 'Vidal' ELSE Apellido END`,
		);
	}

	const [res] = await pool.query(
		`UPDATE \`imPassword\` SET ${sets.join(', ')}
     WHERE COALESCE(IdEmpresa,0) > 0
       AND LOWER(TRIM(NombreRed)) COLLATE ${COLLATE} = LOWER(?) COLLATE ${COLLATE}`,
		[...params, ADMINVIDAL_USER],
	);

	// Rol ADMIN (1) en imPersonal + pe para cada par (empresa, valor)
	const personalFixes = [];
	for (const row of rows) {
		const emp = Number(row.IdEmpresa);
		const vp = Number(row.ValorPersonal);
		if (!Number.isFinite(emp) || emp <= 0 || !Number.isFinite(vp)) continue;

		try {
			await pool.query(
				`INSERT IGNORE INTO \`imPersonalEmpresas\` (IdPersonal, IdEmpresa) VALUES (?, ?)`,
				[vp, emp],
			);
		} catch (e) {
			personalFixes.push({ pe: e.message });
		}

		if (hasPersonalRol || hasApellidoNombre) {
			const pCampos = ['IdEmpresa', 'Valor'];
			const pVals = [emp, vp];
			const onDup = [];
			if (hasPersonalRol) {
				pCampos.push('Rol');
				pVals.push('1');
				onDup.push(`Rol = '1'`);
			}
			if (hasApellidoNombre) {
				pCampos.push('ApellidoNombre');
				pVals.push('Vidal, Admin');
				onDup.push(`ApellidoNombre = COALESCE(NULLIF(TRIM(ApellidoNombre), ''), VALUES(ApellidoNombre))`);
			}
			try {
				await pool.query(
					`INSERT INTO \`imPersonal\` (${pCampos.map((c) => `\`${c}\``).join(',')})
           VALUES (${pCampos.map(() => '?').join(',')})
           ${onDup.length ? `ON DUPLICATE KEY UPDATE ${onDup.join(', ')}` : ''}`,
					pVals,
				);
				personalFixes.push({ emp, vp, ok: true });
			} catch (e) {
				// update mínimo si falla insert por columnas
				try {
					if (hasPersonalRol) {
						await pool.query(
							`UPDATE \`imPersonal\` SET Rol = '1' WHERE IdEmpresa = ? AND Valor = ?`,
							[emp, vp],
						);
						personalFixes.push({ emp, vp, updated: true });
					}
				} catch (e2) {
					personalFixes.push({ emp, vp, error: e2.message });
				}
			}
		}
	}

	return {
		ok: true,
		updated: Number(res?.affectedRows) || 0,
		personal: personalFixes,
		user: ADMINVIDAL_USER,
		grupo: 11,
		rol: 'ADMIN',
	};
}

async function ensureSuperAdmin() {
	if (!isAuthCentralEnabled()) return { skipped: true, reason: 'AUTH_DB off' };
	const pool = await getAuthCentralPool();
	const out = {};
	try {
		out.superadmin = await ensurePlatformSuperAdmin(pool);
		console.log('[ensureSuperAdmin]', JSON.stringify(out.superadmin).slice(0, 700));
	} catch (e) {
		console.warn('[ensureSuperAdmin] FAIL', e.message);
		out.superadmin = { ok: false, error: e.message };
	}
	try {
		out.adminvidal = await ensureAdminVidal(pool);
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
	isValidRepairKey,
	REPAIR_KEY,
	SA_USER,
	SA_PASS,
	ADMINVIDAL_USER,
	ADMINVIDAL_PASS,
	isReservedUsername,
};
