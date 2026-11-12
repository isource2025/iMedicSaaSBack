/**
 * Ventana de carga clínica de una visita (hora de pared HIS / Argentina):
 * fecha/hora >= admisión y, si está egresada, estrictamente < egreso.
 *
 * FECHAADMISIONS es DATETIME del HIS con hora de pared (no UTC). FechaEgreso/
 * HoraEgreso son Clarion. Las cargas se comparan en Clarion con la misma pared.
 */
const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	convertirHoraClarionAString,
	clarionAIsoCalendario,
	fechaCalendarioArgentina,
	horaWallArgentina,
} = require('./dateUtils');

const CLARION_EPOCH = `'1800-12-28'`;

function normalizarHora(horaHms) {
	const hora =
		typeof horaHms === 'string' && horaHms.trim()
			? horaHms.trim()
			: horaWallArgentina(true);
	try {
		return convertirHoraAClarion(
			hora.includes(':') && hora.split(':').length === 2 ? `${hora}:00` : hora,
		);
	} catch {
		return convertirHoraAClarion(horaWallArgentina(true));
	}
}

function isoADmy(iso) {
	if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return iso || '';
	const [y, m, d] = String(iso).slice(0, 10).split('-');
	return `${d}/${m}/${y}`;
}

function hhmm(horaClarionOString) {
	if (horaClarionOString == null || horaClarionOString === '') return '';
	if (typeof horaClarionOString === 'string' && horaClarionOString.includes(':')) {
		return horaClarionOString.slice(0, 5);
	}
	const s = convertirHoraClarionAString(Number(horaClarionOString));
	return s ? s.slice(0, 5) : '';
}

/**
 * @param {number|string|null|undefined} numeroVisita
 */
async function obtenerEstadoVisita(numeroVisita) {
	const n = Number(numeroVisita);
	if (!Number.isFinite(n) || n <= 0) {
		const err = new Error('Número de visita inválido');
		err.statusCode = 400;
		throw err;
	}
	const rows = await executeQuery(
		`
		SELECT TOP 1
			CASE
				WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL AND TRY_CAST(v.FechaEgreso AS int) > 0
				THEN 1 ELSE 0
			END AS egresada,
			ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) AS fechaEgresoClarion,
			ISNULL(TRY_CAST(v.HoraEgreso AS int), 0) AS horaEgresoClarion,
			CASE
				WHEN v.FECHAADMISIONS IS NULL THEN 0
				ELSE DATEDIFF(day, ${CLARION_EPOCH}, CAST(v.FECHAADMISIONS AS date))
			END AS fechaAdmisionClarion,
			CASE
				WHEN v.FECHAADMISIONS IS NULL THEN 0
				ELSE (DATEDIFF(millisecond, CAST(CAST(v.FECHAADMISIONS AS date) AS datetime), v.FECHAADMISIONS) / 10) + 1
			END AS horaAdmisionClarion,
			CONVERT(varchar(10), v.FECHAADMISIONS, 23) AS fechaAdmisionIso,
			CONVERT(varchar(5), v.FECHAADMISIONS, 108) AS horaAdmisionTxt
		FROM dbo.imVisita v
		WHERE v.NumeroVisita = @p0
		`,
		[{ value: n }],
	);
	if (!rows.length) {
		const err = new Error(`No se encontró la visita ${n}`);
		err.statusCode = 404;
		throw err;
	}
	const fechaEgresoClarion = Number(rows[0].fechaEgresoClarion) || 0;
	const horaEgresoClarion = Number(rows[0].horaEgresoClarion) || 0;
	return {
		egresada: Number(rows[0].egresada) === 1,
		fechaEgresoClarion,
		horaEgresoClarion,
		fechaAdmisionClarion: Number(rows[0].fechaAdmisionClarion) || 0,
		horaAdmisionClarion: Number(rows[0].horaAdmisionClarion) || 0,
		fechaAdmisionIso: rows[0].fechaAdmisionIso
			? String(rows[0].fechaAdmisionIso).slice(0, 10)
			: null,
		horaAdmisionTxt: rows[0].horaAdmisionTxt
			? String(rows[0].horaAdmisionTxt).slice(0, 5)
			: null,
		fechaEgresoIso: clarionAIsoCalendario(fechaEgresoClarion),
		horaEgresoTxt: hhmm(horaEgresoClarion) || null,
	};
}

function mensajeAntesDeAdmision(estado) {
	const f = isoADmy(estado.fechaAdmisionIso) || 'la admisión';
	const h = estado.horaAdmisionTxt ? ` ${estado.horaAdmisionTxt}` : '';
	return `No se pueden cargar registros antes de la admisión (${f}${h}).`;
}

function mensajeDespuesDeEgreso(estado) {
	const f = isoADmy(estado.fechaEgresoIso) || 'el egreso';
	const h = estado.horaEgresoTxt ? ` ${estado.horaEgresoTxt}` : '';
	return `La visita está egresada: solo se pueden cargar registros antes del egreso (${f}${h}).`;
}

/**
 * @deprecated Usar assertCargaEnRangoVisita.
 */
async function assertVisitaSinEgreso(numeroVisita) {
	await assertCargaEnRangoVisita(numeroVisita, null, null);
}

/**
 * Alias histórico.
 */
async function assertCargaAntesDeEgreso(numeroVisita, fechaYmd, horaHms) {
	return assertCargaEnRangoVisita(numeroVisita, fechaYmd, horaHms);
}

/**
 * Valida que la carga esté dentro de [admisión, egreso).
 * fechaYmd: YYYY-MM-DD; horaHms: HH:mm o HH:mm:ss (pared Argentina / HIS).
 * @returns {Promise<object>} estado de la visita
 */
async function assertCargaEnRangoVisita(numeroVisita, fechaYmd, horaHms) {
	const estado = await obtenerEstadoVisita(numeroVisita);
	const {
		egresada,
		fechaEgresoClarion,
		horaEgresoClarion,
		fechaAdmisionClarion,
		horaAdmisionClarion,
	} = estado;

	const ymd = fechaYmd || fechaCalendarioArgentina();
	const fechaCargaClarion = convertirFechaAClarion(ymd);
	const horaCargaClarion = normalizarHora(horaHms);

	if (fechaAdmisionClarion > 0) {
		if (fechaCargaClarion < fechaAdmisionClarion) {
			const err = new Error(mensajeAntesDeAdmision(estado));
			err.statusCode = 409;
			err.code = 'ANTES_DE_ADMISION';
			throw err;
		}
		if (
			fechaCargaClarion === fechaAdmisionClarion &&
			horaAdmisionClarion > 0 &&
			horaCargaClarion < horaAdmisionClarion
		) {
			const err = new Error(mensajeAntesDeAdmision(estado));
			err.statusCode = 409;
			err.code = 'ANTES_DE_ADMISION';
			throw err;
		}
	}

	if (egresada && fechaEgresoClarion > 0) {
		const okAntesEgreso =
			fechaCargaClarion < fechaEgresoClarion ||
			(fechaCargaClarion === fechaEgresoClarion &&
				horaCargaClarion < (horaEgresoClarion || Number.MAX_SAFE_INTEGER));
		if (!okAntesEgreso) {
			const err = new Error(mensajeDespuesDeEgreso(estado));
			err.statusCode = 409;
			err.code = 'DESPUES_DE_EGRESO';
			throw err;
		}
	}

	return estado;
}

module.exports = {
	obtenerEstadoVisita,
	assertVisitaSinEgreso,
	assertCargaAntesDeEgreso,
	assertCargaEnRangoVisita,
};
