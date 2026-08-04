/**
 * Hashing Argon2id y verificación dual (hash + legacy plaintext durante migración).
 */
const argon2 = require('argon2');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');

const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 };

async function hashPassword(plain) {
	return argon2.hash(String(plain || ''), ARGON2_OPTS);
}

function rowPasswordFields(row) {
	if (!row) return { hash: null, legacy: null };
	return {
		hash: row.PasswordHash ?? row.passwordHash ?? null,
		legacy: row.Password ?? row.password ?? null,
	};
}

function matchesLegacyPassword(plain, legacy) {
	if (legacy == null) return false;
	// Legacy Clarion (imPassword.Password): comparación case-insensitive
	return String(legacy).trim().toUpperCase() === String(plain).trim().toUpperCase();
}

/**
 * Verifica contraseña. Prioriza Argon2 si hay hash; si falla o no hay hash,
 * acepta el campo legacy (Password) para no bloquear usuarios migrados / reseteados.
 */
async function verifyPassword(plain, row) {
	if (plain == null || plain === '' || !row) return false;
	const plainStr = String(plain);
	const { hash, legacy } = rowPasswordFields(row);

	if (hash && String(hash).startsWith('$argon2')) {
		try {
			if (await argon2.verify(String(hash), plainStr)) return true;
		} catch {
			/* continuar a legacy */
		}
	}

	return matchesLegacyPassword(plainStr, legacy);
}

async function upgradePasswordHashCentral(idEmpresa, valorPersonal, plain) {
	if (!isAuthCentralEnabled() || !plain) return;
	try {
		const pool = await getAuthCentralPool();
		const hash = await hashPassword(plain);
		await pool.query(
			`UPDATE \`imPassword\` SET PasswordHash = ? WHERE IdEmpresa = ? AND ValorPersonal = ?`,
			[hash, Number(idEmpresa), Number(valorPersonal)],
		);
	} catch (e) {
		console.warn('[password] upgradePasswordHashCentral:', e.message);
	}
}

async function upgradePasswordHashTenant(pool, valorPersonal, plain) {
	if (!pool || !plain) return;
	try {
		const hash = await hashPassword(plain);
		const cols = await pool.request().query(`
      SELECT LOWER(name) AS col FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.imPassword') AND name = 'PasswordHash'
    `);
		if (!cols.recordset?.length) return;
		await pool
			.request()
			.input('hash', hash)
			.input('vp', Number(valorPersonal))
			.query(`UPDATE dbo.imPassword SET PasswordHash = @hash WHERE ValorPersonal = @vp`);
	} catch (e) {
		console.warn('[password] upgradePasswordHashTenant:', e.message);
	}
}

/** Anula PasswordHash en MySQL (p. ej. tras cambio de clave legacy). */
async function clearPasswordHashCentral(idEmpresa, valorPersonal) {
	if (!isAuthCentralEnabled()) return;
	try {
		const pool = await getAuthCentralPool();
		await pool.query(
			`UPDATE \`imPassword\` SET PasswordHash = NULL WHERE IdEmpresa = ? AND ValorPersonal = ?`,
			[Number(idEmpresa), Number(valorPersonal)],
		);
	} catch (e) {
		console.warn('[password] clearPasswordHashCentral:', e.message);
	}
}

module.exports = {
	hashPassword,
	verifyPassword,
	matchesLegacyPassword,
	upgradePasswordHashCentral,
	upgradePasswordHashTenant,
	clearPasswordHashCentral,
};
