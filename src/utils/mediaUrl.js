/**
 * URLs firmadas de vida corta para las fotos de pacientes que sirve el
 * backend (/media/patients y el alias legado /uploads).
 *
 * El front las usa en <img src>, que no manda el header Authorization; por
 * eso cada URL que devuelve la API lleva `?exp=&sig=` y el middleware acepta
 * esa firma o una sesión válida (cookie / Bearer).
 *
 * `exp` se redondea a la hora siguiente para que la URL sea estable un rato y
 * el navegador pueda cachear la imagen.
 */
const crypto = require('crypto');
const { JWT_SECRET } = require('../config/jwt');

const SIGNED_PREFIXES = ['/media/patients/', '/uploads/'];
const DEFAULT_TTL_S = 2 * 60 * 60;
const BUCKET_S = 60 * 60;

function secret() {
	const own = String(process.env.MEDIA_URL_SECRET || '').trim();
	if (own) return own;
	return crypto.createHmac('sha256', String(JWT_SECRET)).update('imedic:media-url').digest('hex');
}

function ttlS() {
	const n = Number(process.env.MEDIA_URL_TTL_S);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_S;
}

function firma(pathname, exp) {
	return crypto
		.createHmac('sha256', secret())
		.update(`${pathname}\n${exp}`)
		.digest('base64')
		.replace(/=+$/, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function isSignedMediaPath(pathname) {
	return SIGNED_PREFIXES.some((p) => String(pathname || '').startsWith(p));
}

function parse(url) {
	const s = String(url || '').trim();
	if (!s) return null;
	try {
		const absolute = /^https?:\/\//i.test(s);
		const u = new URL(s, 'http://relativa.invalid');
		return { u, absolute };
	} catch {
		return null;
	}
}

/**
 * Agrega `exp` y `sig` a una URL de foto propia. Las URLs de otros recursos
 * se devuelven sin cambios.
 * @param {string} url relativa (/media/patients/x.jpg) o absoluta
 * @param {{ now?: number }} [opts]
 */
function signMediaUrl(url, { now = Date.now() } = {}) {
	const p = parse(url);
	if (!p || !isSignedMediaPath(p.u.pathname)) return url;
	const base = Math.floor(now / 1000) + ttlS();
	const exp = Math.ceil(base / BUCKET_S) * BUCKET_S;
	p.u.searchParams.delete('exp');
	p.u.searchParams.delete('sig');
	p.u.searchParams.set('exp', String(exp));
	p.u.searchParams.set('sig', firma(decodeSafe(p.u.pathname), exp));
	return p.absolute ? p.u.toString() : `${p.u.pathname}${p.u.search}`;
}

/** Quita `exp`/`sig` antes de guardar una URL que mandó el front. */
function stripMediaSignature(url) {
	const p = parse(url);
	if (!p || !isSignedMediaPath(p.u.pathname)) return url;
	if (!p.u.searchParams.has('sig') && !p.u.searchParams.has('exp')) return url;
	p.u.searchParams.delete('exp');
	p.u.searchParams.delete('sig');
	return p.absolute ? p.u.toString() : `${p.u.pathname}${p.u.search}`;
}

function decodeSafe(s) {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** @returns {boolean} */
function verifyMediaRequest(pathname, query, now = Date.now()) {
	const exp = Number(query && query.exp);
	const sig = String((query && query.sig) || '');
	if (!Number.isFinite(exp) || !sig) return false;
	if (Math.floor(now / 1000) > exp) return false;
	const want = firma(decodeSafe(pathname), exp);
	const a = Buffer.from(sig);
	const b = Buffer.from(want);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
	SIGNED_PREFIXES,
	signMediaUrl,
	stripMediaSignature,
	verifyMediaRequest,
	isSignedMediaPath,
};
