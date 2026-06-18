/**
 * Normalización y extracción de DNI argentino (7-8 dígitos) desde texto libre.
 */

function _soloDigitos(s) {
	return String(s || '').replace(/\D/g, '');
}

function esLongitudDniValida(digits) {
	return digits.length >= 7 && digits.length <= 8;
}

/**
 * Extrae DNI de un mensaje (acepta puntos, espacios, guiones, etc.).
 * @returns {string|null} dígitos sin separadores
 */
function extraerDniDesdeTexto(texto) {
	const raw = String(texto || '').trim();
	if (!raw) return null;

	if (/^[\d.\s,\-/()]+$/.test(raw)) {
		const d = _soloDigitos(raw);
		if (esLongitudDniValida(d)) return d;
		return null;
	}

	const formatted = raw.match(/\d{1,2}[.\s,\-/]+\d{3}[.\s,\-/]+\d{3,4}/);
	if (formatted) {
		const d = _soloDigitos(formatted[0]);
		if (esLongitudDniValida(d)) return d;
	}

	const plain = raw.match(/(?:^|[^\d])(\d{7,8})(?:[^\d]|$)/);
	if (plain) return plain[1];

	return null;
}

/**
 * @returns {number} DNI como entero
 */
function validarDniNumero(dni) {
	const digits = _soloDigitos(dni);
	if (!esLongitudDniValida(digits)) {
		const e = new Error('Número de documento inválido');
		e.statusCode = 400;
		e.code = 'DNI_INVALIDO';
		throw e;
	}
	const n = Number(digits);
	if (!Number.isFinite(n) || n <= 0) {
		const e = new Error('Número de documento inválido');
		e.statusCode = 400;
		e.code = 'DNI_INVALIDO';
		throw e;
	}
	return n;
}

module.exports = {
	extraerDniDesdeTexto,
	validarDniNumero,
};
