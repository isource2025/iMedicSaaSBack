const crypto = require('crypto');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const { runWithTenant } = require('../context/tenantContext');
const { executeQuery } = require('../models/db');

let tableReady = false;

function newToken() {
	return crypto.randomBytes(24).toString('hex');
}

async function ensureIndexTable() {
	if (!isAuthCentralEnabled()) return false;
	if (tableReady) return true;
	try {
		const pool = await getAuthCentralPool();
		await pool.query(`
      CREATE TABLE IF NOT EXISTS imTurneroTokens (
        PublicToken VARCHAR(64) NOT NULL PRIMARY KEY,
        IdEmpresa INT NOT NULL,
        FechaModificacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX IX_imTurneroTokens_Empresa (IdEmpresa)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
		tableReady = true;
		return true;
	} catch (e) {
		console.warn('[turnero] No se pudo crear imTurneroTokens en MySQL:', e.message);
		return false;
	}
}

async function upsertToken(publicToken, idEmpresa) {
	const token = String(publicToken || '').trim();
	const id = Number(idEmpresa);
	if (!token || !Number.isFinite(id) || id <= 0) return;
	const ok = await ensureIndexTable();
	if (!ok) return;
	try {
		const pool = await getAuthCentralPool();
		await pool.query(
			`INSERT INTO imTurneroTokens (PublicToken, IdEmpresa)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE IdEmpresa = VALUES(IdEmpresa), FechaModificacion = CURRENT_TIMESTAMP`,
			[token, id],
		);
	} catch (e) {
		console.warn('[turnero] upsertToken MySQL:', e.message);
	}
}

async function removeToken(publicToken) {
	const token = String(publicToken || '').trim();
	if (!token) return;
	const ok = await ensureIndexTable();
	if (!ok) return;
	try {
		const pool = await getAuthCentralPool();
		await pool.query(`DELETE FROM imTurneroTokens WHERE PublicToken = ?`, [token]);
	} catch {
		/* ignore */
	}
}

async function resolveEmpresaByToken(publicToken) {
	const token = String(publicToken || '').trim();
	if (!token) return null;

	const ok = await ensureIndexTable();
	if (ok) {
		try {
			const pool = await getAuthCentralPool();
			const [rows] = await pool.query(
				`SELECT IdEmpresa FROM imTurneroTokens WHERE PublicToken = ? LIMIT 1`,
				[token],
			);
			if (rows?.length) {
				const id = Number(rows[0].IdEmpresa);
				if (Number.isFinite(id) && id > 0) return id;
			}
		} catch {
			/* fallback below */
		}
	}

	const fallbackEmpresa = Number(process.env.TURNERO_EMPRESA_ID || process.env.BOT_EMPRESA_ID || 0);
	if (Number.isFinite(fallbackEmpresa) && fallbackEmpresa > 0) {
		const found = await runWithTenant(fallbackEmpresa, async () => {
			const rows = await executeQuery(
				`SELECT TOP 1 1 AS ok FROM dbo.imTurneroPantalla WHERE PublicToken = @p0 AND Activa = 1`,
				[{ value: token, type: 'NVarChar' }],
			);
			return rows.length > 0;
		});
		if (found) return fallbackEmpresa;
	}

	return null;
}

module.exports = {
	newToken,
	upsertToken,
	removeToken,
	resolveEmpresaByToken,
};
