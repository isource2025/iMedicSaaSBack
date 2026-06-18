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
		OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '(set)' : '(missing)',
		BOT_API_KEY: process.env.BOT_API_KEY?.trim() ? 'set' : 'MISSING',
		GROQ_API_KEY: process.env.GROQ_API_KEY?.trim() ? 'set' : 'MISSING (audios no se transcriben)',
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

async function testMetaAppSecretOnStartup() {
	const appId = String(process.env.META_APP_ID || '').trim();
	const secret = String(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '')
		.trim()
		.replace(/^["']+|["']+$/g, '');

	if (!appId || !secret) {
		warn('startup', 'META_APP_ID o META_APP_SECRET no configurados — skip Graph API test');
		global.__metaAppSecretGraphOk = false;
		return false;
	}

	try {
		const token = `${appId}|${secret}`;
		const url = `https://graph.facebook.com/v21.0/${appId}?fields=id,name&access_token=${encodeURIComponent(token)}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.error) {
			global.__metaAppSecretGraphOk = false;
			warn('startup', 'META_APP_SECRET inválido para Graph API', {
				appId,
				secretLen: secret.length,
				graphError: data.error.message,
				code: data.error.code,
				hint: 'Meta Developers → App → Configuración básica → Clave secreta → copiar de nuevo a Railway META_APP_SECRET',
			});
			return false;
		}
		global.__metaAppSecretGraphOk = true;
		line('startup', 'META_APP_SECRET válido (Graph API OK)', {
			appId: data.id,
			appName: data.name,
			secretLen: secret.length,
		});
		await testMetaWebhookSubscriptions(appId, token);
		return true;
	} catch (e) {
		global.__metaAppSecretGraphOk = false;
		warn('startup', 'No se pudo verificar META_APP_SECRET vía Graph API', { error: e.message });
		return false;
	}
}

async function testMetaWebhookSubscriptions(appId, appToken) {
	try {
		const url = `https://graph.facebook.com/v21.0/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`;
		const resp = await fetch(url);
		const data = await resp.json();
		if (data.error) {
			warn('startup', 'No se pudieron listar suscripciones webhook del app', {
				error: data.error.message,
			});
			return;
		}
		const subs = data.data || [];
		line('startup', 'Webhook subscriptions en app Meta', {
			appId,
			count: subs.length,
			items: subs.map((s) => ({
				object: s.object,
				callback_url: s.callback_url,
				active: s.active,
				fields: s.fields,
			})),
		});
		const wa = subs.find((s) => s.object === 'whatsapp_business_account');
		const callback = wa?.callback_url || null;
		const domain = process.env.RAILWAY_PUBLIC_DOMAIN || '';
		if (callback && domain && !String(callback).includes(domain)) {
			line('startup', 'Webhook Meta registrado en otro dominio (puede ser intencional)', {
				callback_url: callback,
				este_servicio: domain,
			});
		}
	} catch (e) {
		warn('startup', 'Error listando subscriptions', { error: e.message });
	}
}

async function testEmpresasOnStartup() {
	try {
		const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
		if (!isAuthCentralEnabled()) {
			line('startup', 'Test empresas: AUTH_DB deshabilitado, skip');
			return;
		}
		const pool = await getAuthCentralPool();
		const [rows] = await pool.query(
			`SELECT IDEMPRESA, DESCRIPCION, DbServer, DbPort, DbName, DbUser,
			        DbPassword, DbPasswordEnc, WhatsAppPhoneNumberId, WhatsAppAccessTokenEnc
			 FROM Empresas ORDER BY IDEMPRESA`,
		);
		if (!rows.length) {
			warn('startup', 'MySQL Empresas vacío — configurá al menos una empresa');
			return;
		}

		line('startup', `Empresas en MySQL: ${rows.length}`);
		for (const r of rows) {
			const hasPlain = r.DbPassword != null && String(r.DbPassword).trim() !== '';
			const hasEnc = Boolean(r.DbPasswordEnc);
			const connOk = Boolean(r.DbServer && r.DbName && r.DbUser && (hasPlain || hasEnc));

			line('startup', `Empresa ${r.IDEMPRESA}`, {
				nombre: r.DESCRIPCION,
				sql: connOk ? `${r.DbServer}:${r.DbPort || 1433}/${r.DbName}` : 'incompleta',
				password: hasPlain ? 'DbPassword' : hasEnc ? 'DbPasswordEnc' : 'ninguna',
			});

			if (!connOk) {
				warn('startup', `Empresa ${r.IDEMPRESA}: conexión tenant incompleta — reconcile/sync fallará`);
				continue;
			}

			if (hasEnc && !hasPlain) {
				const dbPwd = logDecryptAttempts(`DbPasswordEnc/empresa${r.IDEMPRESA}`, r.DbPasswordEnc);
				if (!dbPwd.ok) {
					warn(
						'startup',
						`Empresa ${r.IDEMPRESA}: DbPasswordEnc NO descifrable — tenant SQL fallará`,
					);
				}
			}

			if (r.WhatsAppAccessTokenEnc) {
				const waTok = logDecryptAttempts(
					`WhatsAppAccessTokenEnc/empresa${r.IDEMPRESA}`,
					r.WhatsAppAccessTokenEnc,
				);
				if (!waTok.ok) {
					warn('startup', `Empresa ${r.IDEMPRESA}: WhatsApp token NO descifrable`);
				}
			}
		}

		// Probe SQL tenant del hospital (BOT_EMPRESA_ID) — el bot no responde sin esto.
		const botEmpresa = Number(process.env.BOT_EMPRESA_ID || 1);
		if (Number.isFinite(botEmpresa) && botEmpresa > 0) {
			try {
				const { testTenantConnection } = require('../config/tenantDb');
				const t0 = Date.now();
				await testTenantConnection(botEmpresa);
				line('startup', `SQL tenant empresa ${botEmpresa}: OK`, { ms: Date.now() - t0 });
				console.log(`✓ SQL tenant empresa ${botEmpresa} accesible (${Date.now() - t0}ms)`);
			} catch (sqlErr) {
				const row = rows.find((r) => Number(r.IDEMPRESA) === botEmpresa);
				const target = row
					? `${row.DbServer}:${row.DbPort || 1433}/${row.DbName}`
					: `empresa ${botEmpresa}`;
				warn('startup', `SQL tenant empresa ${botEmpresa} INACCESIBLE`, {
					target,
					error: sqlErr.message,
					code: sqlErr.code,
				});
				console.error('');
				console.error('══════════════════════════════════════════════════════════════');
				console.error(`✗ SQL tenant INACCESIBLE — el bot WhatsApp NO puede responder`);
				console.error(`  Destino: ${target}`);
				console.error(`  Error:   ${sqlErr.message}`);
				console.error('  Railway no llega al SQL Server del hospital (firewall / puerto 1433).');
				console.error('  Abrí el puerto 1433 en el firewall para las IPs de salida de Railway.');
				console.error('══════════════════════════════════════════════════════════════');
				console.error('');
			}
		}
	} catch (e) {
		warn('startup', 'Test empresas falló', { error: e.message });
	}
}

async function testEmpresa1OnStartup() {
	return testEmpresasOnStartup();
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
	testMetaAppSecretOnStartup,
	testEmpresa1OnStartup,
	testEmpresasOnStartup,
	sha256Preview,
	labelSecret,
};
