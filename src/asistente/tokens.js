/**
 * Conteo de tokens con el tokenizador real de OpenAI (o200k_base: familia gpt-4o / 4.1 / 5).
 * Se carga una sola vez y bajo demanda (~1 s). Si no está instalado, aproxima por caracteres.
 */
const CHARS_POR_TOKEN = 3.6;
const ENCODING = 'o200k_base';

let encoder;

function cargar() {
	if (encoder !== undefined) return encoder;
	try {
		const { getEncoding } = require('js-tiktoken');
		encoder = getEncoding(ENCODING);
	} catch (e) {
		console.warn('[asistente] js-tiktoken no disponible, se aproximan tokens por caracteres:', e.message);
		encoder = null;
	}
	return encoder;
}

function contar(texto) {
	const s = typeof texto === 'string' ? texto : texto == null ? '' : JSON.stringify(texto);
	if (!s) return 0;
	const enc = cargar();
	if (!enc) return Math.ceil(s.length / CHARS_POR_TOKEN);
	return enc.encode(s).length;
}

function nombreTokenizador() {
	return cargar() ? ENCODING : 'aprox_caracteres';
}

module.exports = { contar, nombreTokenizador, CHARS_POR_TOKEN };
