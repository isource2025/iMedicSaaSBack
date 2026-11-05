/**
 * Ventana de carga clínica de una visita:
 * fecha/hora >= admisión y, si está egresada, estrictamente < egreso.
 */
const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
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
			END AS horaAdmisionClarion
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
	return {
		egresada: Number(rows[0].egresada) === 1,
		fechaEgresoClarion: Number(rows[0].fechaEgresoClarion) || 0,
		horaEgresoClarion: Number(rows[0].horaEgresoClarion) || 0,
		fechaAdmisionClarion: Number(rows[0].fechaAdmisionClarion) || 0,
		horaAdmisionClarion: Number(rows[0].horaAdmisionClarion) || 0,
	};
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
			const err = new Error(
				'No se pueden agregar registros con fecha/hora anteriores a la admisión.',
			);
			err.statusCode = 409;
			throw err;
		}
		if (
			fechaCargaClarion === fechaAdmisionClarion &&
			horaAdmisionClarion > 0 &&
			horaCargaClarion < horaAdmisionClarion
		) {
			const err = new Error(
				'No se pueden agregar registros con fecha/hora anteriores a la admisión.',
			);
			err.statusCode = 409;
			throw err;
		}
	}

	if (egresada && fechaEgresoClarion > 0) {
		const okAntesEgreso =
			fechaCargaClarion < fechaEgresoClarion ||
			(fechaCargaClarion === fechaEgresoClarion &&
				horaCargaClarion < (horaEgresoClarion || Number.MAX_SAFE_INTEGER));
		if (!okAntesEgreso) {
			const err = new Error(
				'La visita está egresada: solo se pueden agregar registros con fecha/hora anteriores al egreso.',
			);
			err.statusCode = 409;
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
