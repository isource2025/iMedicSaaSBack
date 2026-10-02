/**
 * Presión arterial media (PAM).
 *
 *   PAM = (PAS + 2 × PAD) / 3     (PAS = máxima/sistólica, PAD = mínima/diastólica)
 *
 * Se guarda como entero (columna `PAMedia` de imInterCtrlFrecuente), redondeada al más cercano.
 * Ej.: 120/80 → 93.
 */

function aNumeroPositivo(v) {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Calcula la PAM a partir de la máxima y la mínima.
 * @returns {number|null} entero, o null si falta algún dato o la mínima supera a la máxima.
 */
function calcularPresionMedia(presionMax, presionMin) {
	const max = aNumeroPositivo(presionMax);
	const min = aNumeroPositivo(presionMin);
	if (max == null || min == null) return null;
	if (min > max) return null;
	return Math.round((max + 2 * min) / 3);
}

/**
 * Valor de PAM a persistir: si hay máxima y mínima válidas se calcula (manda sobre lo que llegue);
 * si no, se conserva la media informada (o 0 cuando no hay nada).
 */
function resolverPresionMedia({ presionMax, presionMin, presionMedia } = {}) {
	const calculada = calcularPresionMedia(presionMax, presionMin);
	if (calculada != null) return calculada;
	return aNumeroPositivo(presionMedia) ?? 0;
}

module.exports = { calcularPresionMedia, resolverPresionMedia };
