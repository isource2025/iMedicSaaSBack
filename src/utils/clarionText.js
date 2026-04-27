/**
 * Normalización de texto para columnas legacy Clarion / VARCHAR ANSI (Windows-1252).
 * - Saltos de línea en CRLF y espacios coherentes (evita desalineación en pantallas viejas).
 * - Caracteres no representables en CP1252 se sustituyen al codificar (p. ej. emoji → '?').
 */
const iconv = require('iconv-lite');

/**
 * @param {unknown} texto
 * @param {{ maxLength?: number }} [options]
 * @returns {string}
 */
function normalizarTextoParaClarionAnsi(texto, options = {}) {
	const { maxLength } = options;
	if (texto == null || texto === undefined) return '';

	let s = String(texto)
		.replace(/\u00a0/g, ' ')
		.replace(/\t/g, ' ')
		.replace(/\r\n|\r|\n/g, '\n')
		.replace(/\n/g, '\r\n')
		.replace(/[ \t]+\r\n/g, '\r\n')
		.replace(/\r\n{3,}/g, '\r\n\r\n')
		.trim();

	s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

	try {
		const buf = iconv.encode(s, 'windows-1252');
		s = iconv.decode(buf, 'windows-1252');
	} catch {
		s = s.replace(/[^\r\n\x20-\x7E\u00A1-\u00FF]/g, '?');
	}

	if (typeof maxLength === 'number' && maxLength > 0 && s.length > maxLength) {
		s = s.slice(0, maxLength);
	}
	return s;
}

module.exports = {
	normalizarTextoParaClarionAnsi,
};
