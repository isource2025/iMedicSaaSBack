/**
 * Logging diagnóstico estructurado (webhook Meta, cifrado tenant, WhatsApp).
 * Activo por defecto; desactivar con DIAG_LOG=0
 */
const crypto = require('crypto');
const { secretsForDecrypt } = require('./dbCrypto');

function enabled() {
	return process.env.DIAG_LOG !== '0';
}

function ts() {
	return new Date().toISOString();
}

function line(tag, msg, extra) {
	if (!enabled()) return;
	const base = `[diag:${tag}] ${ts()} ${msg}`;
	if (extra != null) {
		console.log(base, typeof extra === 'object' ? JSON.stringify(extra) : extra);
	} else {
		console.log(base);
	}
}

function warn(tag, msg, extra) {
	if (!enabled()) return;
	const base = `[diag:${tag}] ${ts()} ${msg}`;
	if (extra != null) {
		console.warn(base, typeof extra === 'object' ? JSON.stringify(extra) : extra);
	} else {
		console.warn(base);
	}
}

function labelSecret(secret) {
	const s = String(secret);
	if (process.env.PLATFORM_DB_SECRET?.trim() === s) return 'PLATFORM_DB_SECRET';
	if (process.env.JWT_SECRET?.trim() === s) return 'JWT_SECRET';
	if (s === 'change-me-platform-db') return 'default-fallback';
	return 'custom-secret';
}

function envSummary() {
	const pds = process.env.PLATFORM_DB_SECRET?.trim();
	const jwt = process.env.JWT_SECRET?.trim();
	const meta = process.env.META_APP_SECRET?.trim();
	return {
		DIAG_LOG: enabled() ? 'on' : 'off',
		NODE_ENV: process.env.NODE_ENV || '(unset)',
		AUTH_DB_ENABLED: process.env.AUTH_DB_ENABLED || '(unset)',
		PLATFORM_DB_SECRET: pds ? `set(len=${pds.length})` : 'MISSING',
		JWT_SECRET: jwt ? `set(len=${jwt.length})` : 'MISSING',
		META_APP_SECRET: meta ? `set(len=${meta.length})` : 'MISSING',
		META_APP_ID: process.env.META_APP_ID?.trim() || 'MISSING',
		WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ? 'set' : 'MISSING',
		BOT_EMPRESA_ID: process.env.BOT_EMPRESA_ID || '1',
		OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() ? 'set' : 'MISSING',
		BOT_GPT_ENABLED: process.env.BOT_GPT_ENABLED ?? '(default on if OpenAI set)',
		BOT_API_KEY: process.env.BOT_API_KEY?.trim() ? 'set' : 'MISSING',
		RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || '(unset)',
	};
}

function logStartupEnv() {
	line('startup', 'Variables de entorno (sin valores secretos)', envSummary());
	const labels = secretsForDecrypt().map(labelSecret);
	line('startup', `Orden descifrado DbPasswordEnc/token: ${labels.join(' → ')}`);
}

function sha256Preview(buf) {
	if (!buf) return null;
	const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
	return crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
}

/**
 * @param {string} context — ej. DbPasswordEnc, WhatsAppAccessTokenEnc
 * @param {string} cipherText
 * @returns {{ ok: boolean, secretUsed?: string, plainLen?: number, attempts: object[] }}
 */
function logDecryptAttempts(context, cipherText) {
	const cipher = String(cipherText || '');
	const attempts = [];
	if (!cipher) {
		warn('crypto', `${context}: cipher vacío`);
		return { ok: false, attempts };
	}

	const buf = Buffer.from(cipher, 'base64');
	line('crypto', `${context}: inicio descifrado`, {
		cipherLen: cipher.length,
		base64DecodedLen: buf.length,
		previewSha256: sha256Preview(buf),
	});

	let lastErr;
	for (const secret of secretsForDecrypt()) {
		const label = labelSecret(secret);
		try {
			const { decryptWithKey } = require('./dbCrypto');
			const plain = decryptWithKey(cipher, secret);
			attempts.push({ secret: label, ok: true, plainLen: plain.length });
			line('crypto', `${context}: OK con ${label}`, { plainLen: plain.length });
			return { ok: true, secretUsed: label, plainLen: plain.length, attempts };
		} catch (e) {
			lastErr = e;
			attempts.push({ secret: label, ok: false, error: e.message });
			warn('crypto', `${context}: falló con ${label}`, { error: e.message });
		}
	}

	warn('crypto', `${context}: NINGÚN secret funcionó`, {
		attempts,
		hint:
			'PLATFORM_DB_SECRET en Railway debe ser el mismo usado al ejecutar scripts/update_empresa_prod_railway.js y setup_whatsapp_bot.js (local: imedic-platform-dev-secret-change-in-prod)',
		lastError: lastErr?.message,
	});
	return { ok: false, attempts };
}

function logWebhookIncoming(req) {
	const sig = req.headers['x-hub-signature-256'];
	const raw = req.rawBody;
	line('webhook', 'POST entrante', {
		method: req.method,
		url: req.originalUrl,
		ip: req.ip || req.headers['x-forwarded-for'] || '?',
		userAgent: req.headers['user-agent'] || '(none)',
		contentType: req.headers['content-type'] || '(none)',
		contentLength: req.headers['content-length'] || (raw ? raw.length : 0),
		hasSignatureHeader: Boolean(sig),
		signaturePrefix: sig ? String(sig).slice(0, 20) + '…' : null,
		rawBodyPresent: Boolean(raw),
		rawBodyLen: raw ? raw.length : 0,
		rawBodySha256: sha256Preview(raw),
		bodyParsedType: req.body == null ? 'null' : Array.isArray(req.body) ? 'array' : typeof req.body,
		object: req.body?.object || null,
		entryCount: req.body?.entry?.length ?? 0,
		isMetaUa: /facebookexternalua|meta-webhooks/i.test(String(req.headers['user-agent'] || '')),
	});
}

function logSignatureResult(req, { ok, expectedHex, receivedHex, error }) {
	const meta = {
		ok,
		rawBodyLen: req.rawBody?.length ?? 0,
		rawBodySha256: sha256Preview(req.rawBody),
		metaAppSecretLen: (process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '').trim().length,
		expectedPrefix: expectedHex ? expectedHex.slice(0, 12) : null,
		receivedPrefix: receivedHex ? receivedHex.slice(0, 12) : null,
		userAgent: req.headers['user-agent'] || '(none)',
		isMetaUa: /facebookexternalua|meta-webhooks/i.test(String(req.headers['user-agent'] || '')),
	};
	if (ok) {
		line('webhook', 'Firma OK', meta);
	} else {
		warn('webhook', error || 'Firma inválida', meta);
		if (!meta.isMetaUa) {
			warn('webhook', 'User-Agent NO es Meta — posible bot/scanner (ignorable si no es facebookexternalua)');
		}
	}
}

function logWebhookProcess(result, body) {
	line('webhook', 'Procesamiento', {
		procesados: result.procesados,
		empresas: result.empresas,
		object: body?.object,
		entryCount: body?.entry?.length ?? 0,
	});
}

function logWhatsappEmpresa(action, data) {
	line('whatsappEmpresa', action, data);
}

async function testEmpresa1OnStartup() {
	try {
		const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
		if (!isAuthCentralEnabled()) {
			line('startup', 'Test empresa 1: AUTH_DB deshabilitado, skip');
			return;
		}
		const pool = await getAuthCentralPool();
		const [rows] = await pool.query(
			`SELECT IDEMPRESA, DESCRIPCION, DbServer, DbPort, DbName, DbUser,
			        DbPasswordEnc, WhatsAppPhoneNumberId, WhatsAppAccessTokenEnc
			 FROM Empresas WHERE IDEMPRESA = 1 LIMIT 1`,
		);
		if (!rows.length) {
			warn('startup', 'Test empresa 1: no existe IDEMPRESA=1 en MySQL');
			return;
		}
		const r = rows[0];
		line('startup', 'Empresa 1 MySQL', {
			id: r.IDEMPRESA,
			nombre: r.DESCRIPCION,
			dbServer: r.DbServer,
			dbPort: r.DbPort,
			dbName: r.DbName,
			dbUser: r.DbUser,
			dbPasswordEncLen: r.DbPasswordEnc ? String(r.DbPasswordEnc).length : 0,
			whatsappPhone: r.WhatsAppPhoneNumberId || null,
			whatsappTokenEncLen: r.WhatsAppAccessTokenEnc ? String(r.WhatsAppAccessTokenEnc).length : 0,
		});

		if (r.DbPasswordEnc) {
			const dbPwd = logDecryptAttempts('DbPasswordEnc/empresa1', r.DbPasswordEnc);
			if (!dbPwd.ok) {
				warn('startup', 'CRÍTICO: DbPasswordEnc empresa 1 NO descifrable — tenant SQL fallará');
			}
		} else {
			warn('startup', 'Empresa 1 sin DbPasswordEnc');
		}

		if (r.WhatsAppAccessTokenEnc) {
			const waTok = logDecryptAttempts('WhatsAppAccessTokenEnc/empresa1', r.WhatsAppAccessTokenEnc);
			if (!waTok.ok) {
				warn('startup', 'WhatsApp token empresa 1 NO descifrable — respuestas salientes fallarán');
			}
		} else {
			warn('startup', 'Empresa 1 sin WhatsAppAccessTokenEnc en MySQL');
		}
	} catch (e) {
		warn('startup', 'Test empresa 1 falló', { error: e.message });
	}
}

module.exports = {
	enabled,
	line,
	warn,
	envSummary,
	logStartupEnv,
	logDecryptAttempts,
	logWebhookIncoming,
	logSignatureResult,
	logWebhookProcess,
	logWhatsappEmpresa,
	testEmpresa1OnStartup,
	sha256Preview,
	labelSecret,
};
