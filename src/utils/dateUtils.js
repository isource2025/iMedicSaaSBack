const CLARION_EPOCH_UTC = Date.UTC(1800, 11, 28);
const DAY_MS = 86400000;

/**
 * Utilidades para manejo de fechas y horas en formato Clarion
 * @module utils/dateUtils
 */

/**
 * Convierte una fecha ISO (YYYY-MM-DD o Date) al Clarion DATE (int)
 *      SQL: DateAdd(day, ClarionDate - 4, '1801-01-01')
 * @param {string|Date} fecha
 * @returns {number} ClarionDate
 */
// Clarion DATE: días transcurridos desde 28/12/1800 (date 0 = 28/12/1800)

// ACEPTA: Date, 'YYYY-MM-DD', 'dd/mm/yyyy' o cualquier fecha parseable por Date.
// DEVUELVE: días Clarion (number) SIN corrimientos por zona horaria.
function convertirFechaAClarion(fecha) {
	if (!fecha) return null;

	let Y, M, D;

	if (fecha instanceof Date) {
		// Tomamos los componentes UTC para evitar corrimientos
		Y = fecha.getUTCFullYear();
		M = fecha.getUTCMonth();
		D = fecha.getUTCDate();
	} else if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
		const [y, m, d] = fecha.split('-').map(Number);
		Y = y;
		M = m - 1;
		D = d;
	} else if (typeof fecha === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
		const [d, m, y] = fecha.split('/').map(Number);
		Y = y;
		M = m - 1;
		D = d;
	} else {
		const d = new Date(fecha);
		if (isNaN(d)) throw new Error('Fecha inválida para conversión a Clarion');
		Y = d.getUTCFullYear();
		M = d.getUTCMonth();
		D = d.getUTCDate();
	}

	const utcMidnight = Date.UTC(Y, M, D);
	return Math.floor((utcMidnight - CLARION_EPOCH_UTC) / DAY_MS);
}

/**
 * Convierte una hora HH:MM o HH:MM:SS al Clarion TIME (int)
 *      SQL: dateadd(ms, (ClarionTIME-1)*10, 0)
 * @param {string} hora
 * @returns {number} ClarionTime
 */
function convertirHoraAClarion(hora) {
	if (typeof hora !== 'string') throw new Error('Hora inválida para conversión a Clarion');
	const [hh = '0', mm = '0', ss = '0'] = hora.split(':');
	const ms =
		parseInt(hh, 10) * 3_600_000 + parseInt(mm, 10) * 60_000 + parseInt(ss, 10) * 1_000;
	return Math.floor(ms / 10) + 1;
}

/**
 * Convierte un Clarion DATE (DDMMYY) a ISO YYYY-MM-DD
 * @param {string|number} fechaClarion
 * @returns {string|null}
 */
function convertirFechaDesdeFormatoClarion(fechaClarion) {
	if (fechaClarion == null) return null;

	const s = String(fechaClarion).trim();
	const soloDigitos = /^\d+$/.test(s);

	// Si NO son exactamente 6 dígitos, lo tratamos como "días Clarion"
	if (soloDigitos && s.length !== 6) {
		const days = Number(s);
		const ms = CLARION_EPOCH_UTC + days * DAY_MS;
		// toISOString es UTC; slice(0,10) evita desfaces por huso horario
		return new Date(ms).toISOString().slice(0, 10);
	}

	// Caso ddmmyy (6 dígitos)
	const padded = s.padStart(6, '0'); // ddmmyy
	const dd = padded.slice(0, 2);
	const mm = padded.slice(2, 4);
	const yy = padded.slice(4, 6);
	const yyyy = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convierte un Clarion TIME (HHMMSS) a HH:MM:SS
 * @param {string|number} horaClarion
 * @returns {string|null}
 */
function convertirHoraDesdeFormatoClarion(horaClarion) {
	if (horaClarion == null) return null;
	const s = String(horaClarion).padStart(6, '0');
	const hh = s.slice(0, 2),
		mm = s.slice(2, 4),
		ss = s.slice(4, 6);
	return `${hh}:${mm}:${ss}`;
}

module.exports = {
	convertirFechaAClarion,
	convertirHoraAClarion,
	convertirFechaDesdeFormatoClarion,
	convertirHoraDesdeFormatoClarion,
};
