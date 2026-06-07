/**
 * Cifrado reversible para contraseñas de conexión SQL por empresa.
 * Requiere PLATFORM_DB_SECRET en .env (o cae en JWT_SECRET).
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKeyFromSecret(secret) {
	return crypto.createHash('sha256').update(String(secret)).digest();
}

function getKey() {
	const secret = process.env.PLATFORM_DB_SECRET || process.env.JWT_SECRET || 'change-me-platform-db';
	return getKeyFromSecret(secret);
}

/** Orden de prueba al descifrar DbPasswordEnc (p. ej. Railway solo tiene JWT_SECRET). */
function secretsForDecrypt() {
	const list = [];
	if (process.env.PLATFORM_DB_SECRET?.trim()) {
		list.push(process.env.PLATFORM_DB_SECRET.trim());
	}
	if (process.env.JWT_SECRET?.trim()) {
		list.push(process.env.JWT_SECRET.trim());
	}
	list.push('change-me-platform-db');
	return [...new Set(list)];
}

function encrypt(plainText) {
	if (plainText == null || String(plainText) === '') return null;
	const iv = crypto.randomBytes(IV_LEN);
	const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
	const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptWithKey(cipherText, secret) {
	if (!cipherText) return '';
	const buf = Buffer.from(String(cipherText), 'base64');
	if (buf.length < IV_LEN + 16) {
		throw new Error('DbPasswordEnc inválido (formato base64 corto)');
	}
	const iv = buf.subarray(0, IV_LEN);
	const tag = buf.subarray(IV_LEN, IV_LEN + 16);
	const data = buf.subarray(IV_LEN + 16);
	const decipher = crypto.createDecipheriv(ALGO, getKeyFromSecret(secret), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function decrypt(cipherText) {
	const secret = process.env.PLATFORM_DB_SECRET || process.env.JWT_SECRET || 'change-me-platform-db';
	return decryptWithKey(cipherText, secret);
}

/**
 * Descifra probando PLATFORM_DB_SECRET, JWT_SECRET y el valor por defecto.
 * Útil cuando el cifrado se hizo en local con PLATFORM_DB_SECRET y en Railway solo está JWT_SECRET (o viceversa).
 */
function decryptTrySecrets(cipherText, context) {
	let lastErr;
	for (const secret of secretsForDecrypt()) {
		try {
			const plain = decryptWithKey(cipherText, secret);
			if (plain) return plain;
		} catch (e) {
			lastErr = e;
		}
	}

	try {
		const diag = require('./diagLog');
		if (diag.enabled()) {
			diag.logDecryptAttempts(context || 'decryptTrySecrets', cipherText);
		}
	} catch {
		/* diag opcional */
	}

	throw lastErr || new Error('No se pudo descifrar DbPasswordEnc con ningún secret configurado');
}

module.exports = { encrypt, decrypt, decryptTrySecrets, decryptWithKey, secretsForDecrypt };
