/**
 * Sincronización en caliente tenant SQL Server → MySQL auth central.
 * Tras crear/actualizar usuarios, personal o vínculos, el login SaaS lee MySQL.
 * Cada fila en Railway lleva IdEmpresa: el id de persona = id del servidor físico.
 */
const { executeQuery } = require('../models/db');
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');

function q(name) {
	return `\`${String(name).replace(/`/g, '``')}\``;
}

const tableColumnsCache = new Map();

async function mysqlExec(sql, params = []) {
	if (!isAuthCentralEnabled()) return;
	const pool = await getAuthCentralPool();
	await pool.query(sql, params);
}

/** Columnas reales de MySQL (evita Unknown column al sincronizar desde SQL Server). */
async function getMysqlTableColumns(table) {
	const key = String(table);
	if (tableColumnsCache.has(key)) return tableColumnsCache.get(key);
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`
    SELECT COLUMN_NAME AS col
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `,
		[key],
	);
	const set = new Set((rows || []).map((r) => String(r.col)));
	tableColumnsCache.set(key, set);
	return set;
}

function isBinaryLike(value) {
	return (
		Buffer.isBuffer(value) ||
		(value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data))
	);
}

async function upsertRow(table, pkColumns, row) {
	if (!row || !isAuthCentralEnabled()) return;
	// Plataforma (IdEmpresa=0) solo se gestiona por ensureSuperAdmin, nunca por sync tenant.
	if (row.IdEmpresa != null && Number(row.IdEmpresa) === 0) {
		console.warn(`[authCentralSync] upsert bloqueado hacia plataforma table=${table}`);
		return;
	}
	const allowed = await getMysqlTableColumns(table);
	const cols = Object.keys(row).filter((c) => {
		if (row[c] === undefined) return false;
		if (!allowed.has(c)) return false;
		// No copiar binarios grandes (Firma, etc.)
		if (isBinaryLike(row[c])) return false;
		return true;
	});
	if (!cols.length) return;

	const pkSet = new Set(pkColumns.map((c) => String(c).toLowerCase()));
	const nonPk = cols.filter((c) => !pkSet.has(String(c).toLowerCase()));
	const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
	const placeholders = cols.map(() => '?').join(', ');
	const updateSql = nonPk.length
		? ` ON DUPLICATE KEY UPDATE ${nonPk.map((c) => `${q(c)} = VALUES(${q(c)})`).join(', ')}`
		: pkColumns.length
			? ` ON DUPLICATE KEY UPDATE ${q(pkColumns[0])} = ${q(pkColumns[0])}`
			: '';

	await mysqlExec(
		`INSERT INTO ${q(table)} (${cols.map((c) => q(c)).join(', ')}) VALUES (${placeholders})${updateSql}`,
		values,
	);
}

async function readTenantRow(table, whereSql, params) {
	const rows = await executeQuery(`SELECT * FROM dbo.${table} WHERE ${whereSql}`, params);
	return rows[0] || null;
}

function omitColumns(row, excluded = []) {
	if (!row) return null;
	const skip = new Set(excluded.map((c) => c.toLowerCase()));
	const out = {};
	for (const [k, v] of Object.entries(row)) {
		if (skip.has(String(k).toLowerCase())) continue;
		out[k] = v;
	}
	return out;
}

async function syncPassword(idEmpresa, valorPersonal) {
	const { isTenantEmpresa, isValidTenantPersonalId, isReservedUsername } = require('../config/tenantIdentity');
	const emp = Number(idEmpresa);
	if (!isTenantEmpresa(emp)) {
		console.warn('[authCentralSync] syncPassword ignorado: IdEmpresa no es tenant', emp);
		return;
	}
	if (!isValidTenantPersonalId(valorPersonal)) {
		console.warn('[authCentralSync] syncPassword ignorado: ValorPersonal inválido', valorPersonal);
		return;
	}
	const row = await readTenantRow('imPassword', 'ValorPersonal = @p0', [
		{ value: valorPersonal, type: 'Int' },
	]);
	if (!row) return;
	if (isReservedUsername(row.NombreRed ?? row.nombrered)) {
		console.warn('[authCentralSync] syncPassword ignorado: username reservado plataforma');
		return;
	}
	row.IdEmpresa = emp;
	// Si el tenant no trae hash (o está vacío), invalidar el de MySQL para no bloquear legacy.
	const hash = row.PasswordHash ?? row.passwordHash;
	if (hash == null || String(hash).trim() === '') {
		row.PasswordHash = null;
	}
	await upsertRow('imPassword', ['IdEmpresa', 'ValorPersonal'], row);
}

async function syncPersonal(idEmpresa, valorPersonal) {
	const { isTenantEmpresa, isValidTenantPersonalId } = require('../config/tenantIdentity');
	const emp = Number(idEmpresa);
	if (!isTenantEmpresa(emp) || !isValidTenantPersonalId(valorPersonal)) return;
	const row = await readTenantRow('imPersonal', 'Valor = @p0', [
		{ value: valorPersonal, type: 'Int' },
	]);
	if (!row) return;
	const out = omitColumns(row, [
		'Firma',
		'emailVerified',
		'image',
		'hospitalId',
		'createdAt',
		'updatedAt',
	]);
	out.IdEmpresa = emp;
	await upsertRow('imPersonal', ['IdEmpresa', 'Valor'], out);
}

async function syncPersonalEmpresa(idEmpresa, idPersonal) {
	const row = await readTenantRow(
		'imPersonalEmpresas',
		'IdPersonal = @p0 AND IdEmpresa = @p1',
		[
			{ value: idPersonal, type: 'Int' },
			{ value: idEmpresa, type: 'Int' },
		],
	);
	if (!row) return;
	await upsertRow('imPersonalEmpresas', ['IdPersonal', 'IdEmpresa'], row);
}

async function removePersonalEmpresa(idEmpresa, idPersonal) {
	if (!isAuthCentralEnabled()) return;
	const emp = Number(idEmpresa);
	const id = Number(idPersonal);
	await mysqlExec(
		`DELETE FROM ${q('imPersonalEmpresas')} WHERE IdPersonal = ? AND IdEmpresa = ?`,
		[id, emp],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPersonalSectores')} WHERE IdEmpresa = ? AND idPersonal = ?`,
		[emp, id],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPassword')} WHERE IdEmpresa = ? AND ValorPersonal = ?`,
		[emp, id],
	);
	await mysqlExec(`DELETE FROM ${q('imPersonal')} WHERE IdEmpresa = ? AND Valor = ?`, [emp, id]);
}

async function syncPersonalSectores(idEmpresa, idPersonal) {
	if (!isAuthCentralEnabled()) return;
	const emp = Number(idEmpresa);
	const id = Number(idPersonal);
	await mysqlExec(`DELETE FROM ${q('imPersonalSectores')} WHERE IdEmpresa = ? AND idPersonal = ?`, [
		emp,
		id,
	]);
	const rows = await executeQuery(
		`SELECT idPersonal, idSector FROM dbo.imPersonalSectores WHERE idPersonal = @p0`,
		[{ value: id, type: 'Int' }],
	);
	for (const row of rows || []) {
		await upsertRow('imPersonalSectores', ['IdEmpresa', 'idPersonal', 'idSector'], {
			...row,
			IdEmpresa: emp,
		});
	}
}

async function removePersonalSector(idEmpresa, idPersonal, idSector) {
	if (!isAuthCentralEnabled()) return;
	await mysqlExec(
		`DELETE FROM ${q('imPersonalSectores')} WHERE IdEmpresa = ? AND idPersonal = ? AND idSector = ?`,
		[Number(idEmpresa), Number(idPersonal), String(idSector)],
	);
}

async function syncSector(idEmpresa, valor) {
	const row = await readTenantRow('imSectores', 'Valor = @p0', [
		{ value: String(valor), type: 'VarChar' },
	]);
	if (!row) return;
	row.IdEmpresa = Number(idEmpresa);
	await upsertRow('imSectores', ['IdEmpresa', 'Valor'], row);
}

async function removeSector(idEmpresa, valor) {
	if (!isAuthCentralEnabled()) return;
	await mysqlExec(`DELETE FROM ${q('imSectores')} WHERE IdEmpresa = ? AND Valor = ?`, [
		Number(idEmpresa),
		String(valor),
	]);
}

async function syncServicio(idEmpresa, valor) {
	const row = await readTenantRow('imServicios', 'LTRIM(RTRIM(Valor)) = @p0', [
		{ value: String(valor), type: 'VarChar' },
	]);
	if (!row) return;
	row.IdEmpresa = Number(idEmpresa);
	await upsertRow('imServicios', ['IdEmpresa', 'Valor'], row);
}

async function removeServicio(idEmpresa, valor) {
	if (!isAuthCentralEnabled()) return;
	await mysqlExec(`DELETE FROM ${q('imServicios')} WHERE IdEmpresa = ? AND Valor = ?`, [
		Number(idEmpresa),
		String(valor),
	]);
}

async function syncPersonalServicios(idEmpresa, idPersonal) {
	if (!isAuthCentralEnabled()) return;
	const emp = Number(idEmpresa);
	const id = Number(idPersonal);
	await mysqlExec(
		`CREATE TABLE IF NOT EXISTS ${q('imPersonalServicios')} (
			IdEmpresa INT NOT NULL,
			idPersonal INT NOT NULL,
			idServicio VARCHAR(20) NOT NULL,
			PRIMARY KEY (IdEmpresa, idPersonal, idServicio)
		)`,
	);
	await mysqlExec(`DELETE FROM ${q('imPersonalServicios')} WHERE IdEmpresa = ? AND idPersonal = ?`, [
		emp,
		id,
	]);
	const rows = await executeQuery(
		`SELECT idPersonal, idServicio FROM dbo.imPersonalServicios WHERE idPersonal = @p0`,
		[{ value: id, type: 'Int' }],
	).catch(() => []);
	for (const row of rows || []) {
		await upsertRow('imPersonalServicios', ['IdEmpresa', 'idPersonal', 'idServicio'], {
			...row,
			IdEmpresa: emp,
		});
	}
}

/** Elimina credenciales auth en MySQL si el personal ya no está vinculado a ninguna empresa tenant. */
async function purgePersonalAuthIfOrphan(valorPersonal) {
	if (!isAuthCentralEnabled()) return;
	const id = Number(valorPersonal);
	if (!Number.isFinite(id) || id <= 0) return;
	const pool = await getAuthCentralPool();
	const [countRows] = await pool.query(
		`SELECT COUNT(*) AS c FROM ${q('imPersonalEmpresas')}
     WHERE IdPersonal = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
	const count = Number(countRows?.[0]?.c) || 0;
	if (count > 0) return;

	// Nunca tocar IdEmpresa=0 (plataforma / superadmin).
	await mysqlExec(
		`DELETE FROM ${q('imPersonalSectores')}
     WHERE idPersonal = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPersonal')} WHERE Valor = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPassword')}
     WHERE ValorPersonal = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
}

/**
 * Elimina del espejo MySQL el login de un personal tenant.
 * Si se pasa idEmpresa, solo borra esa empresa; si no, todas las filas tenant (nunca plataforma).
 */
async function purgePersonalAuth(valorPersonal, idEmpresa = null) {
	if (!isAuthCentralEnabled()) return;
	const id = Number(valorPersonal);
	if (!Number.isFinite(id) || id <= 0) return;
	const emp =
		idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0
			? Number(idEmpresa)
			: null;

	if (emp != null) {
		await mysqlExec(`DELETE FROM ${q('imPersonalEmpresas')} WHERE IdPersonal = ? AND IdEmpresa = ?`, [
			id,
			emp,
		]);
		await mysqlExec(
			`DELETE FROM ${q('imPersonalSectores')} WHERE idPersonal = ? AND IdEmpresa = ?`,
			[id, emp],
		);
		await mysqlExec(`DELETE FROM ${q('imPersonal')} WHERE Valor = ? AND IdEmpresa = ?`, [id, emp]);
		await mysqlExec(
			`DELETE FROM ${q('imPassword')} WHERE ValorPersonal = ? AND IdEmpresa = ?`,
			[id, emp],
		);
		return;
	}

	await mysqlExec(
		`DELETE FROM ${q('imPersonalEmpresas')} WHERE IdPersonal = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPersonalSectores')} WHERE idPersonal = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPersonal')} WHERE Valor = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
	await mysqlExec(
		`DELETE FROM ${q('imPassword')} WHERE ValorPersonal = ? AND COALESCE(IdEmpresa, 0) > 0`,
		[id],
	);
}

/**
 * Bundle completo para que el usuario pueda iniciar sesión en la empresa.
 */
async function syncUserLoginBundle(idEmpresa, valorPersonal) {
	if (!isAuthCentralEnabled()) return;
	// Password + vínculo primero: sin ellos el login SaaS falla.
	await syncPassword(idEmpresa, valorPersonal);
	await syncPersonalEmpresa(idEmpresa, valorPersonal);
	try {
		await syncPersonal(idEmpresa, valorPersonal);
	} catch (e) {
		console.warn('[authCentralSync] syncPersonal:', e.message);
	}
	try {
		await syncPersonalSectores(idEmpresa, valorPersonal);
	} catch (e) {
		console.warn('[authCentralSync] syncPersonalSectores:', e.message);
	}
}

async function vincularUsuarioEmpresaTenant(idEmpresa, valorPersonal) {
	await executeQuery(
		`
    IF NOT EXISTS (SELECT 1 FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1)
      INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (@p0, @p1)
    `,
		[
			{ value: valorPersonal, type: 'Int' },
			{ value: idEmpresa, type: 'Int' },
		],
	);
	await syncPersonalEmpresa(idEmpresa, valorPersonal);
}

module.exports = {
	syncPassword,
	syncPersonal,
	syncPersonalEmpresa,
	removePersonalEmpresa,
	syncPersonalSectores,
	removePersonalSector,
	syncSector,
	removeSector,
	syncServicio,
	removeServicio,
	syncPersonalServicios,
	purgePersonalAuthIfOrphan,
	purgePersonalAuth,
	syncUserLoginBundle,
	vincularUsuarioEmpresaTenant,
};
