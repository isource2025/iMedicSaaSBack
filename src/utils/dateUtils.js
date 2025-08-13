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
function convertirFechaAClarion(fecha) {
	if (!fecha) return null;
	const epoch = Date.UTC(1800, 11, 28); // 28 Dec 1800
	const d = fecha instanceof Date ? fecha : new Date(fecha);
	if (isNaN(d)) throw new Error('Fecha inválida para conversión a Clarion');
	const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
	const diff = Math.floor((utc - epoch) / 86400000);
	return diff; // sin offset adicional
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
	const s = String(fechaClarion).padStart(6, '0');
	const dd = s.slice(0, 2),
		mm = s.slice(2, 4),
		yy = s.slice(4, 6);
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
