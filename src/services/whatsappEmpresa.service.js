/**
 * Configuración WhatsApp Meta por empresa.
 *
 * Multi-tenant nube:
 *   MySQL Empresas (central)  → fuente de verdad: phone_number_id → IDEMPRESA + token cifrado
 *   imBotConfig (tenant SQL)  → espejo operativo + fallback dev local (AUTH_DB=0)
 *
 * Global (.env): META_APP_ID, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_GRAPH_VERSION
 */
const { runWithTenant } = require('../context/tenantContext');
const { encrypt, decryptTrySecrets } = require('../utils/dbCrypto');
const diag = require('../utils/diagLog');
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const botConfigService = require('./botConfig.service');

const CACHE_MS = 60_000;
/** @type {Map<string, { exp: number, data: object }>} */
const phoneCache = new Map();
/** @type {Map<number, { exp: number, data: object }>} */
const empresaCache = new Map();

function graphVersion() {
	return String(process.env.WHATSAPP_GRAPH_VERSION || 'v21.0').trim();
}

function maskToken(token) {
	if (!token) return null;
	const t = String(token);
	if (t.length <= 12) return '***';
	return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function parseEmpresasJsonEnv() {
	const raw = process.env.WHATSAPP_EMPRESAS_JSON;
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function configFromPlain({ idEmpresa, phoneNumberId, wabaId, accessToken, source }) {
	return {
		idEmpresa: Number(idEmpresa),
		phoneNumberId: phoneNumberId ? String(phoneNumberId) : null,
		wabaId: wabaId ? String(wabaId) : null,
		accessToken: accessToken ? String(accessToken) : null,
		accessTokenMasked: maskToken(accessToken),
		source,
		graphVersion: graphVersion(),
		metaAppId: process.env.META_APP_ID || null,
	};
}

async function getMysqlColumns(pool) {
	const [rows] = await pool.query(
		`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas'`,
	);
	return new Set(rows.map((r) => String(r.COLUMN_NAME)));
}

async function loadFromMysqlByPhone(phoneNumberId) {
	if (!isAuthCentralEnabled()) return null;
	const pool = await getAuthCentralPool();
	const cols = await getMysqlColumns(pool);
	if (!cols.has('WhatsAppPhoneNumberId')) return null;

	const [rows] = await pool.query(
		`SELECT IDEMPRESA, WhatsAppPhoneNumberId, WhatsAppWabaId, WhatsAppAccessTokenEnc
		 FROM Empresas
		 WHERE WhatsAppPhoneNumberId = ?
		 LIMIT 1`,
		[String(phoneNumberId)],
	);
	if (!rows.length) return null;
	const r = rows[0];
	let accessToken = null;
	if (r.WhatsAppAccessTokenEnc) {
		try {
			accessToken = decryptTrySecrets(r.WhatsAppAccessTokenEnc, 'WhatsAppAccessTokenEnc/mysql');
		} catch (e) {
			diag.warn('whatsappEmpresa', 'token MySQL no descifrable', {
				idEmpresa: r.IDEMPRESA,
				phoneNumberId: r.WhatsAppPhoneNumberId,
				error: e.message,
			});
			console.warn('[whatsappEmpresa] token MySQL no descifrable:', e.message);
		}
	}
	diag.logWhatsappEmpresa('loadFromMysqlByPhone', {
		phoneNumberId,
		idEmpresa: r.IDEMPRESA,
		hasToken: Boolean(accessToken),
		tokenEncLen: r.WhatsAppAccessTokenEnc ? String(r.WhatsAppAccessTokenEnc).length : 0,
	});
	return configFromPlain({
		idEmpresa: r.IDEMPRESA,
		phoneNumberId: r.WhatsAppPhoneNumberId,
		wabaId: r.WhatsAppWabaId,
		accessToken,
		source: 'mysql_empresas',
	});
}

async function loadFromMysqlByEmpresa(idEmpresa) {
	if (!isAuthCentralEnabled()) return null;
	const pool = await getAuthCentralPool();
	const cols = await getMysqlColumns(pool);
	if (!cols.has('WhatsAppPhoneNumberId')) return null;

	const [rows] = await pool.query(
		`SELECT IDEMPRESA, WhatsAppPhoneNumberId, WhatsAppWabaId, WhatsAppAccessTokenEnc
		 FROM Empresas WHERE IDEMPRESA = ? LIMIT 1`,
		[Number(idEmpresa)],
	);
	if (!rows.length) return null;
	const r = rows[0];
	let accessToken = null;
	if (r.WhatsAppAccessTokenEnc) {
		try {
		 accessToken = decryptTrySecrets(r.WhatsAppAccessTokenEnc, 'WhatsAppAccessTokenEnc/mysql-empresa');
		} catch {
			/* ignore */
		}
	}
	return configFromPlain({
		idEmpresa: r.IDEMPRESA,
		phoneNumberId: r.WhatsAppPhoneNumberId,
		wabaId: r.WhatsAppWabaId,
		accessToken,
		source: 'mysql_empresas',
	});
}

async function loadFromTenantImBotConfig(idEmpresa) {
	return runWithTenant(idEmpresa, async () => {
		const map = await botConfigService.getDbConfigMap();
		const phoneNumberId = map.whatsapp_phone_number_id || null;
		const wabaId = map.whatsapp_waba_id || null;
		let accessToken = null;
		if (map.whatsapp_access_token_enc) {
			try {
				accessToken = decryptTrySecrets(String(map.whatsapp_access_token_enc), 'WhatsAppAccessTokenEnc/imBotConfig');
			} catch {
				/* ignore */
			}
		}
		if (!phoneNumberId && !accessToken) return null;
		return configFromPlain({
			idEmpresa,
			phoneNumberId,
			wabaId,
			accessToken,
			source: 'imbotconfig_tenant',
		});
	});
}

function loadFromEnvByPhone(phoneNumberId) {
	const map = parseEmpresasJsonEnv();
	const entry = map[String(phoneNumberId)];
	if (entry) {
		return configFromPlain({
			idEmpresa: entry.idEmpresa ?? entry.id ?? process.env.BOT_EMPRESA_ID,
			phoneNumberId,
			wabaId: entry.wabaId ?? entry.waba_id,
			accessToken: entry.accessToken ?? entry.access_token,
			source: 'env_json',
		});
	}

	const envPhone = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
	if (envPhone && envPhone === String(phoneNumberId)) {
		return configFromPlain({
			idEmpresa: process.env.BOT_EMPRESA_ID || 1,
			phoneNumberId: envPhone,
			wabaId: process.env.WHATSAPP_WABA_ID,
			accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
			source: 'env_default',
		});
	}
	return null;
}

function loadFromEnvByEmpresa(idEmpresa) {
	const id = Number(idEmpresa);
	const defaultEmpresa = Number(process.env.BOT_EMPRESA_ID || 1);
	if (id !== defaultEmpresa) {
		const map = parseEmpresasJsonEnv();
		for (const [phone, entry] of Object.entries(map)) {
			const eid = Number(entry.idEmpresa ?? entry.id);
			if (eid === id) {
				return configFromPlain({
					idEmpresa: id,
					phoneNumberId: phone,
					wabaId: entry.wabaId ?? entry.waba_id,
					accessToken: entry.accessToken ?? entry.access_token,
					source: 'env_json',
				});
			}
		}
		return null;
	}

	if (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_ACCESS_TOKEN) {
		return configFromPlain({
			idEmpresa: id,
			phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
			wabaId: process.env.WHATSAPP_WABA_ID,
			accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
			source: 'env_default',
		});
	}
	return null;
}

function cacheGet(map, key) {
	const hit = map.get(key);
	if (hit && hit.exp > Date.now()) return hit.data;
	return null;
}

function cacheSet(map, key, data) {
	map.set(key, { exp: Date.now() + CACHE_MS, data });
}

/**
 * Resuelve empresa y credenciales Meta a partir del Phone Number ID del webhook.
 */
async function resolveByPhoneNumberId(phoneNumberId) {
	const phone = String(phoneNumberId || '').trim();
	if (!phone) return null;

	const cached = cacheGet(phoneCache, phone);
	if (cached) return cached;

	const chain = [
		() => loadFromMysqlByPhone(phone),
		() => Promise.resolve(loadFromEnvByPhone(phone)),
	];

	for (const fn of chain) {
		const cfg = await fn();
		if (cfg?.idEmpresa) {
			cacheSet(phoneCache, phone, cfg);
			cacheSet(empresaCache, cfg.idEmpresa, cfg);
			return cfg;
		}
	}

	return null;
}

async function getConfigForEmpresa(idEmpresa) {
	const id = Number(idEmpresa);
	if (!Number.isFinite(id) || id <= 0) return null;

	const cached = cacheGet(empresaCache, id);
	if (cached) return cached;

	const chain = [
		() => loadFromMysqlByEmpresa(id),
		() => Promise.resolve(loadFromEnvByEmpresa(id)),
		() => loadFromTenantImBotConfig(id),
	];

	for (const fn of chain) {
		const cfg = await fn();
		if (cfg && (cfg.phoneNumberId || cfg.accessToken)) {
			cacheSet(empresaCache, id, cfg);
			if (cfg.phoneNumberId) cacheSet(phoneCache, cfg.phoneNumberId, cfg);
			return cfg;
		}
	}
	return null;
}

/** Config pública para admin (sin token completo). */
async function getPublicConfigForEmpresa(idEmpresa) {
	const cfg = await getConfigForEmpresa(idEmpresa);
	if (!cfg) {
		return {
			configurado: false,
			idEmpresa: Number(idEmpresa),
			phoneNumberId: null,
			wabaId: null,
			accessTokenMasked: null,
			source: null,
			metaAppId: process.env.META_APP_ID || null,
			verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim()),
		};
	}
	return {
		configurado: Boolean(cfg.phoneNumberId && cfg.accessToken),
		idEmpresa: cfg.idEmpresa,
		phoneNumberId: cfg.phoneNumberId,
		wabaId: cfg.wabaId,
		accessTokenMasked: cfg.accessTokenMasked,
		source: cfg.source,
		metaAppId: process.env.META_APP_ID || null,
		verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim()),
	};
}

async function saveConfigForEmpresa(idEmpresa, { phoneNumberId, wabaId, accessToken }) {
	const id = Number(idEmpresa);
	const enc =
		accessToken != null && String(accessToken).trim() !== ''
			? encrypt(String(accessToken).trim())
			: undefined;

	// MySQL central si existe
	if (isAuthCentralEnabled()) {
		try {
			const pool = await getAuthCentralPool();
			const cols = await getMysqlColumns(pool);
			if (cols.has('WhatsAppPhoneNumberId')) {
				const sets = [];
				const params = [];
				if (phoneNumberId != null) {
					sets.push('WhatsAppPhoneNumberId = ?');
					params.push(phoneNumberId ? String(phoneNumberId).trim() : null);
				}
				if (wabaId != null) {
					sets.push('WhatsAppWabaId = ?');
					params.push(wabaId ? String(wabaId).trim() : null);
				}
				if (enc !== undefined) {
					sets.push('WhatsAppAccessTokenEnc = ?');
					params.push(enc);
				}
				if (sets.length) {
					params.push(id);
					await pool.query(
						`UPDATE Empresas SET ${sets.join(', ')} WHERE IDEMPRESA = ?`,
						params,
					);
				}
			}
		} catch (e) {
			console.warn('[whatsappEmpresa] save MySQL:', e.message);
		}
	}

	// Siempre en imBotConfig tenant (backup / local)
	await runWithTenant(id, async () => {
		if (phoneNumberId != null) {
			await botConfigService.upsertConfigClave(
				'whatsapp_phone_number_id',
				String(phoneNumberId).trim(),
				'string',
			);
		}
		if (wabaId != null) {
			await botConfigService.upsertConfigClave('whatsapp_waba_id', String(wabaId).trim(), 'string');
		}
		if (accessToken != null && String(accessToken).trim() !== '') {
			await botConfigService.upsertConfigClave(
				'whatsapp_access_token_enc',
				encrypt(String(accessToken).trim()),
				'string',
			);
		}
	});

	phoneCache.clear();
	empresaCache.clear();
	return getPublicConfigForEmpresa(id);
}

function invalidateCache() {
	phoneCache.clear();
	empresaCache.clear();
}

module.exports = {
	graphVersion,
	maskToken,
	resolveByPhoneNumberId,
	getConfigForEmpresa,
	getPublicConfigForEmpresa,
	saveConfigForEmpresa,
	invalidateCache,
};
