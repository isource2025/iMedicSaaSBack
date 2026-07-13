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
	// Manejar null y undefined - retornar null para fechas opcionales
	if (fecha === null || fecha === undefined) {
		return null;
	}
	
	// Epoch Clarion: 28/12/1800 (debe coincidir con SQL: '1800-12-28')
	const base = Date.UTC(1800, 11, 28); // 28 Dec 1800
	
	// Parsear fecha de entrada
	let d;
	if (fecha instanceof Date) {
		d = fecha;
	} else if (typeof fecha === 'string') {
		// Si es string YYYY-MM-DD, parsear como fecha local
		const parts = fecha.split('-');
		
		if (parts.length !== 3) {
			throw new Error(`Formato de fecha inválido: esperado YYYY-MM-DD, recibido: ${fecha}`);
		}
		
		const [year, month, day] = parts.map(Number);
		
		if (isNaN(year) || isNaN(month) || isNaN(day)) {
			throw new Error(`Fecha con valores no numéricos: ${fecha}`);
		}
		
		d = new Date(year, month - 1, day);
	} else {
		throw new Error(`Formato de fecha inválido: tipo ${typeof fecha}, valor: ${fecha}`);
	}
	
	if (isNaN(d.getTime())) throw new Error('Fecha inválida para conversión a Clarion');
	
	// Usar UTC para el cálculo
	const utcFecha = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
	const diffDias = Math.floor((utcFecha - base) / 86400000);
	return diffDias;
}
/**
 * Convierte una hora HH:MM o HH:MM:SS al Clarion TIME (int)
 *      SQL: dateadd(ms, (ClarionTIME-1)*10, 0)
 * @param {string} hora
 * @returns {number} ClarionTime
 */
function convertirHoraAClarion(hora) {
	// Manejar null y undefined - retornar null para horas opcionales
	if (hora === null || hora === undefined) {
		return null;
	}
	
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

/**
 * Convierte un Clarion DATE (días desde 28/12/1800) a fecha JavaScript
 * @param {number} fechaClarion - Días desde el epoch Clarion
 * @returns {Date|null} - Objeto Date o null
 */
function convertirFechaClarionADate(fechaClarion) {
	if (!fechaClarion || fechaClarion <= 0) return null;
	
	try {
		// Epoch Clarion: 28/12/1800
		const epochClarion = new Date(1800, 11, 28); // 28 Dec 1800
		const fecha = new Date(epochClarion.getTime() + (fechaClarion * 24 * 60 * 60 * 1000));
		return fecha;
	} catch (error) {
		console.error('Error al convertir fecha Clarion:', error);
		return null;
	}
}

/**
 * Convierte un Clarion TIME a HH:MM:SS
 * Basado en el comentario SQL: dateadd(ms, (ClarionTIME-1)*10, 0)
 * @param {number} horaClarion - Valor TIME de Clarion
 * @returns {string|null} - Hora en formato HH:MM:SS o null
 */
function convertirHoraClarionAString(horaClarion) {
	if (!horaClarion || horaClarion <= 0) return null;
	
	try {
		// Según el comentario en dateUtils: dateadd(ms, (ClarionTIME-1)*10, 0)
		// Esto significa: milisegundos = (horaClarion - 1) * 10
		const milisegundosTotales = (horaClarion - 1) * 10;
		
		// Convertir milisegundos a horas, minutos y segundos
		const horas = Math.floor(milisegundosTotales / 3600000);
		const minutos = Math.floor((milisegundosTotales % 3600000) / 60000);
		const segundos = Math.floor((milisegundosTotales % 60000) / 1000);
		
		// Validar que los valores estén en rangos correctos
		if (horas >= 24 || minutos >= 60 || segundos >= 60) {
			console.warn(`Hora Clarion fuera de rango: ${horaClarion} -> ${horas}:${minutos}:${segundos}`);
			// Intentar interpretación alternativa: podría ser formato HHMMSSCC (hora, minuto, segundo, centésimas)
			const str = horaClarion.toString().padStart(8, '0');
			const h = parseInt(str.substring(0, 2), 10);
			const m = parseInt(str.substring(2, 4), 10);
			const s = parseInt(str.substring(4, 6), 10);
			
			if (h < 24 && m < 60 && s < 60) {
				return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
			}
		}
		
		return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;
	} catch (error) {
		console.error('Error al convertir hora Clarion:', error);
		return null;
	}
}

const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires';

const DIAS_AGENDA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

/** Fecha calendario YYYY-MM-DD en Argentina (independiente del TZ del servidor). */
function fechaCalendarioArgentina(ref = new Date()) {
	return ref.toLocaleDateString('en-CA', { timeZone: TZ_ARGENTINA });
}

/**
 * Partes de fecha/hora wall-clock en Argentina (Intl, no getHours del proceso).
 * @returns {{ fecha: string, hora: string, horaCorta: string, diaSemana: string, diaSemanaIdx: number }}
 */
function partesFechaHoraArgentina(ref = new Date()) {
	const fecha = fechaCalendarioArgentina(ref);
	const horaParts = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ_ARGENTINA,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).formatToParts(ref);
	const get = (t) => horaParts.find((p) => p.type === t)?.value || '00';
	const hora = `${get('hour')}:${get('minute')}:${get('second')}`;
	const horaCorta = `${get('hour')}:${get('minute')}`;

	// weekday en inglés → índice 0=Sunday
	const wd = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ_ARGENTINA,
		weekday: 'short',
	}).format(ref);
	const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	const diaSemanaIdx = map[wd] ?? 0;

	return {
		fecha,
		hora,
		horaCorta,
		diaSemana: DIAS_AGENDA[diaSemanaIdx],
		diaSemanaIdx,
	};
}

function horaWallArgentina(conSegundos = true, ref = new Date()) {
	const p = partesFechaHoraArgentina(ref);
	return conSegundos ? p.hora : p.horaCorta;
}

function diaSemanaAgendaArgentina(ref = new Date()) {
	return partesFechaHoraArgentina(ref).diaSemana;
}

function horaClarionAhoraArgentina(ref = new Date()) {
	return convertirHoraAClarion(horaWallArgentina(true, ref));
}

function fechaClarionHoyArgentina(ref = new Date()) {
	return convertirFechaAClarion(fechaCalendarioArgentina(ref));
}

/** Suma días al calendario argentino y devuelve YYYY-MM-DD. */
function fechaIsoOffsetArgentina(diasDesdeHoy = 0) {
	const hoy = fechaCalendarioArgentina();
	const [y, mo, d] = hoy.split('-').map(Number);
	const date = new Date(Date.UTC(y, mo - 1, d + diasDesdeHoy, 12, 0, 0));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Formatea un instante (Date/ISO/SQL datetime) como HH:MM en Argentina.
 * Datetimes sin zona se interpretan como hora de Argentina (no UTC del servidor).
 */
function formatHoraArgentina(value) {
	if (value == null || value === '') return '';
	let d;
	if (value instanceof Date) {
		d = value;
	} else {
		const s = String(value).trim();
		if (!s) return '';
		let normalizado = s;
		if (!s.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(s)) {
			if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
				normalizado = s.replace(' ', 'T');
				if (!/[+-]\d{2}:\d{2}$/.test(normalizado) && !normalizado.endsWith('Z')) {
					normalizado = `${normalizado}-03:00`;
				}
			}
		}
		d = new Date(normalizado);
	}
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString('es-AR', {
		timeZone: TZ_ARGENTINA,
		hour: '2-digit',
		minute: '2-digit',
	});
}

module.exports = {
	convertirFechaAClarion,
	convertirHoraAClarion,
	convertirFechaDesdeFormatoClarion,
	convertirHoraDesdeFormatoClarion,
	convertirFechaClarionADate,
	convertirHoraClarionAString,
	fechaCalendarioArgentina,
	fechaIsoOffsetArgentina,
	partesFechaHoraArgentina,
	horaWallArgentina,
	diaSemanaAgendaArgentina,
	horaClarionAhoraArgentina,
	fechaClarionHoyArgentina,
	formatHoraArgentina,
	TZ_ARGENTINA,
	DIAS_AGENDA,
};
