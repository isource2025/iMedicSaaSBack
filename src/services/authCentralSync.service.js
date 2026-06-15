/**
 * Sincronización en caliente tenant SQL Server → MySQL auth central.
 * Tras crear/actualizar usuarios, personal o vínculos, el login SaaS lee MySQL.
 */
const { executeQuery } = require('../models/db');
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');

function q(name) {
	return `\`${String(name).replace(/`/g, '``')}\``;
}

async function mysqlExec(sql, params = []) {
	if (!isAuthCentralEnabled()) return;
	const pool = await getAuthCentralPool();
	await pool.query(sql, params);
}

async function upsertRow(table, pkColumns, row) {
	if (!row || !isAuthCentralEnabled()) return;
	const cols = Object.keys(row).filter((c) => row[c] !== undefined);
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

async function syncPassword(valorPersonal) {
	const row = await readTenantRow('imPassword', 'ValorPersonal = @p0', [
		{ value: valorPersonal, type: 'Int' },
	]);
	if (!row) return;
	await upsertRow('imPassword', ['ValorPersonal'], row);
}

async function syncPersonal(valorPersonal) {
	const row = await readTenantRow('imPersonal', 'Valor = @p0', [
		{ value: valorPersonal, type: 'Int' },
	]);
	if (!row) return;
	await upsertRow('imPersonal', ['Valor'], omitColumns(row, ['Firma']));
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
	await mysqlExec(
		`DELETE FROM ${q('imPersonalEmpresas')} WHERE IdPersonal = ? AND IdEmpresa = ?`,
		[idPersonal, idEmpresa],
	);
}

async function syncPersonalSectores(idPersonal) {
	const rows = await executeQuery(
		`SELECT idPersonal, idSector FROM dbo.imPersonalSectores WHERE idPersonal = @p0`,
		[{ value: idPersonal, type: 'Int' }],
	);
	for (const row of rows || []) {
		await upsertRow('imPersonalSectores', ['idPersonal', 'idSector'], row);
	}
}

async function removePersonalSector(idPersonal, idSector) {
	if (!isAuthCentralEnabled()) return;
	await mysqlExec(
		`DELETE FROM ${q('imPersonalSectores')} WHERE idPersonal = ? AND idSector = ?`,
		[idPersonal, String(idSector)],
	);
}

async function syncSector(valor) {
	const row = await readTenantRow('imSectores', 'Valor = @p0', [
		{ value: String(valor), type: 'VarChar' },
	]);
	if (!row) return;
	await upsertRow('imSectores', ['Valor'], row);
}

async function removeSector(valor) {
	if (!isAuthCentralEnabled()) return;
	await mysqlExec(`DELETE FROM ${q('imSectores')} WHERE Valor = ?`, [String(valor)]);
}

/**
 * Bundle completo para que el usuario pueda iniciar sesión en la empresa.
 */
async function syncUserLoginBundle(idEmpresa, valorPersonal) {
	if (!isAuthCentralEnabled()) return;
	await syncPassword(valorPersonal);
	await syncPersonal(valorPersonal);
	await syncPersonalEmpresa(idEmpresa, valorPersonal);
	await syncPersonalSectores(valorPersonal);
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
	syncUserLoginBundle,
	vincularUsuarioEmpresaTenant,
};
