/**
 * Texto legacy Clarion / VARCHAR ANSI (Windows-1252) y reparación de mojibake UTF-8.
 *
 * Caso típico: byte 0xD1 (Ñ en CP1252) leído como UTF-8 → U+FFFD () → "ACUA".
 */
const iconv = require('iconv-lite');
const { decodeMultipartFilename } = require('./fileNameEncoding');

const SPANISH_CHARS = /[ñÑáéíóúÁÉÍÓÚüÜ¿¡]/;

/**
 * Decodifica un Buffer HTTP/SQL eligiendo UTF-8 o Windows-1252.
 * Si UTF-8 produce U+FFFD, prueba CP1252 (Clarion / APIs latin1).
 * @param {Buffer} buf
 * @returns {string}
 */
/**
 * "ï¿½" = los 3 bytes UTF-8 de U+FFFD (EF BF BD) leídos como Latin-1/CP1252.
 * Es la firma de un carácter ya perdido río arriba que se decodificó dos veces.
 */
const FFFD_LEIDO_COMO_LATIN1 = /\u00EF\u00BF\u00BD/g;

/** UTF-8 estricto: devuelve null si el buffer NO es UTF-8 válido. */
function decodeUtf8Estricto(buf) {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
	} catch {
		return null;
	}
}

function decodeBufferPreferUtf8(buf) {
	if (!Buffer.isBuffer(buf) || buf.length === 0) return '';

	// 1) Si es UTF-8 válido, ES UTF-8 (aunque traiga un U+FFFD legítimo del origen).
	//    Antes se reintentaba como CP1252 y EF BF BD terminaba como "ï¿½".
	const estricto = decodeUtf8Estricto(buf);
	if (estricto !== null) return estricto;

	// 2) No es UTF-8 válido: es ANSI (Clarion / APIs latin1) → Windows-1252.
	try {
		return iconv.decode(buf, 'windows-1252');
	} catch {
		return buf.toString('latin1');
	}
}

/**
 * Bytes CP1252 de un string cuyos code units son "bytes leídos como CP1252/Latin-1"
 * (incluye ‘ ’ “ ” … del rango 0x80-0x9F). null si algún carácter no encaja.
 */
function bytesCp1252(s) {
	const out = Buffer.alloc(s.length);
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code <= 0xff) {
			out[i] = code;
			continue;
		}
		const b = iconv.encode(s[i], 'windows-1252');
		if (b.length !== 1 || iconv.decode(b, 'windows-1252') !== s[i]) return null;
		out[i] = b[0];
	}
	return out;
}

/**
 * Nombres/domicilios de personas (RENAPER): cuando el origen ya perdió la Ñ y mandó U+FFFD,
 * la Ñ es prácticamente el único caso posible entre vocal y vocal/fin de palabra
 * (ACU�A, NU�EZ, ORGO�). No toca "ATENCI�N", "MART�N", "PA�S" (vocal + FFFD + consonante).
 * @param {string} s
 */
function restaurarEnieDePersona(s) {
	if (typeof s !== 'string' || !s.includes('\uFFFD')) return s;
	return s.replace(
		/([AEIOUaeiou\u00C1\u00C9\u00CD\u00D3\u00DA\u00E1\u00E9\u00ED\u00F3\u00FA])\uFFFD(?![bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ])/g,
		(_m, prev) => prev + (prev === prev.toUpperCase() ? '\u00D1' : '\u00F1'),
	);
}

/**
 * @param {unknown} texto
 * @param {{ maxLength?: number }} [options]
 * @returns {string}
 */
function normalizarTextoParaClarionAnsi(texto, options = {}) {
	const { maxLength } = options;
	if (texto == null || texto === undefined) return '';

	let s = repararTextoClarionAnsi(String(texto));
	s = s
		.replace(/\u00a0/g, ' ')
		.replace(/\t/g, ' ')
		.replace(/\r\n|\r|\n/g, '\n')
		.replace(/\n/g, '\r\n')
		.replace(/[ \t]+\r\n/g, '\r\n')
		.replace(/\r\n{3,}/g, '\r\n\r\n')
		.trim();

	s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
	// No persistir el carácter de reemplazo UTF-8
	s = s.replace(/\uFFFD/g, '');

	try {
		const buf = iconv.encode(s, 'windows-1252');
		s = iconv.decode(buf, 'windows-1252');
	} catch {
		s = s.replace(/[^\r\n\x20-\x7E\u00A1-\u00FF]/g, '');
	}

	if (typeof maxLength === 'number' && maxLength > 0 && s.length > maxLength) {
		s = s.slice(0, maxLength);
	}
	return s;
}

/**
 * Repara texto ya materializado como string JS (mojibake UTF-8 / latin1).
 * @param {unknown} texto
 * @returns {string|null|undefined}
 */
function repararTextoClarionAnsi(texto) {
	if (texto == null) return texto;
	let s = String(texto);
	if (!s) return s;

	s = decodeMultipartFilename(s);

	// Mojibake típico "ACUÃ'A" / "ACUÃ?A" si decodeMultipart no alcanzó
	if (/Ã[\u0080-\u00FF'?‘’]/.test(s) || /Ã./.test(s)) {
		try {
			const bytes = bytesCp1252(s);
			const decoded = bytes ? decodeUtf8Estricto(bytes) : null;
			if (decoded !== null && !decoded.includes('\uFFFD') && (SPANISH_CHARS.test(decoded) || decoded.length < s.length)) {
				s = decoded;
			}
		} catch {
			/* keep */
		}
	}

	// "ï¿½" (U+FFFD mal decodificado) → U+FFFD real; nunca dejar esa basura visible ni persistirla.
	s = s.replace(FFFD_LEIDO_COMO_LATIN1, '\uFFFD');

	try {
		return s.normalize('NFC');
	} catch {
		return s;
	}
}

/** Recorre objetos/arrays y repara strings que lucen corruptos (lecturas SQL / JSON). */
function repararStringsDeep(value, depth = 0, opts = {}) {
	if (depth > 8) return value;
	if (typeof value === 'string') {
		if (!/Ã|Â|\u00EF\u00BF\u00BD|\uFFFD|[\u0080-\u009F]/.test(value)) return value;
		const fixed = repararTextoClarionAnsi(value);
		return opts.restaurarEnie ? restaurarEnieDePersona(fixed) : fixed;
	}
	if (Array.isArray(value)) {
		return value.map((v) => repararStringsDeep(v, depth + 1, opts));
	}
	if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = repararStringsDeep(v, depth + 1, opts);
		}
		return out;
	}
	return value;
}

/**
 * Valor de texto que va a la BD: repara mojibake y elimina U+FFFD / "ï¿½"
 * (nunca persistir basura de codificación, venga de donde venga el request).
 * @param {unknown} v
 */
function sanitizarTextoParaBd(v) {
	if (typeof v !== 'string') return v;
	if (!/Ã|Â|\u00EF\u00BF\u00BD|\uFFFD/.test(v)) return v;
	return repararTextoClarionAnsi(v).replace(/\uFFFD/g, '');
}

module.exports = {
	sanitizarTextoParaBd,
	restaurarEnieDePersona,
	decodeBufferPreferUtf8,
	normalizarTextoParaClarionAnsi,
	repararTextoClarionAnsi,
	repararStringsDeep,
};
