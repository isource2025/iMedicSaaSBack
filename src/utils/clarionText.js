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
function decodeBufferPreferUtf8(buf) {
	if (!Buffer.isBuffer(buf) || buf.length === 0) return '';
	const utf8 = buf.toString('utf8');
	if (!utf8.includes('\uFFFD')) return utf8;

	try {
		const cp1252 = iconv.decode(buf, 'windows-1252');
		if (!cp1252.includes('\uFFFD') && (SPANISH_CHARS.test(cp1252) || cp1252.length >= utf8.length)) {
			return cp1252;
		}
	} catch {
		/* keep */
	}

	try {
		const latin1 = buf.toString('latin1');
		if (SPANISH_CHARS.test(latin1)) return latin1;
	} catch {
		/* keep */
	}

	return utf8;
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

	// Si quedó U+FFFD, reinterpreta code units como latin1→utf8 (a veces ayuda con dobles)
	if (s.includes('\uFFFD')) {
		try {
			const asBuf = Buffer.from(s, 'binary');
			const retried = decodeBufferPreferUtf8(asBuf);
			if (!retried.includes('\uFFFD') && SPANISH_CHARS.test(retried)) {
				s = retried;
			}
		} catch {
			/* keep */
		}
	}

	// Mojibake típico "ACUÃ'A" / "ACUÃ?A" si decodeMultipart no alcanzó
	if (/Ã[\u0080-\u00FF'?‘’]/.test(s) || /Ã./.test(s)) {
		try {
			const decoded = Buffer.from(s, 'latin1').toString('utf8');
			if (!decoded.includes('\uFFFD') && (SPANISH_CHARS.test(decoded) || decoded.length < s.length)) {
				s = decoded;
			}
		} catch {
			/* keep */
		}
	}

	try {
		return s.normalize('NFC');
	} catch {
		return s;
	}
}

/** Recorre objetos/arrays y repara strings que lucen corruptos (lecturas SQL / JSON). */
function repararStringsDeep(value, depth = 0) {
	if (depth > 8) return value;
	if (typeof value === 'string') {
		if (!/Ã|Â|\uFFFD|[\u0080-\u009F]/.test(value)) return value;
		return repararTextoClarionAnsi(value);
	}
	if (Array.isArray(value)) {
		return value.map((v) => repararStringsDeep(v, depth + 1));
	}
	if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = repararStringsDeep(v, depth + 1);
		}
		return out;
	}
	return value;
}

module.exports = {
	decodeBufferPreferUtf8,
	normalizarTextoParaClarionAnsi,
	repararTextoClarionAnsi,
	repararStringsDeep,
};
