/**
 * Cifrado reversible para contraseñas de conexión SQL por empresa.
 * Requiere PLATFORM_DB_SECRET en .env (o cae en JWT_SECRET).
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
	const secret = process.env.PLATFORM_DB_SECRET || process.env.JWT_SECRET || 'change-me-platform-db';
	return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(plainText) {
	if (plainText == null || String(plainText) === '') return null;
	const iv = crypto.randomBytes(IV_LEN);
	const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
	const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(cipherText) {
	if (!cipherText) return '';
	const buf = Buffer.from(String(cipherText), 'base64');
	if (buf.length < IV_LEN + 16) return '';
	const iv = buf.subarray(0, IV_LEN);
	const tag = buf.subarray(IV_LEN, IV_LEN + 16);
	const data = buf.subarray(IV_LEN + 16);
	const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
