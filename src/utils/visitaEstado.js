/**
 * Estado de la visita (internada vs egresada) para gates de escritura clínica.
 * Visita egresada: se puede cargar/editar solo con fecha-hora estrictamente anterior al egreso.
 */
const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	fechaCalendarioArgentina,
	horaWallArgentina,
} = require('./dateUtils');

/**
 * @param {number|string|null|undefined} numeroVisita
 * @returns {Promise<{ egresada: boolean, fechaEgresoClarion: number, horaEgresoClarion: number }>}
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
			ISNULL(TRY_CAST(v.HoraEgreso AS int), 0) AS horaEgresoClarion
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
	};
}

/**
 * @deprecated Preferir assertCargaAntesDeEgreso con fecha/hora del registro.
 */
async function assertVisitaSinEgreso(numeroVisita) {
	await assertCargaAntesDeEgreso(numeroVisita, null, null);
}

/**
 * Bloquea altas clínicas en visita egresada si la fecha/hora de carga
 * no es estrictamente anterior a FechaEgreso + HoraEgreso.
 *
 * @param {number|string|null|undefined} numeroVisita
 * @param {string|null|undefined} fechaYmd YYYY-MM-DD (default: hoy AR)
 * @param {string|null|undefined} horaHms HH:mm[:ss] (default: ahora AR)
 * @returns {Promise<{ egresada: boolean, fechaEgresoClarion: number, horaEgresoClarion: number }>}
 */
async function assertCargaAntesDeEgreso(numeroVisita, fechaYmd, horaHms) {
	const estado = await obtenerEstadoVisita(numeroVisita);
	const { egresada, fechaEgresoClarion, horaEgresoClarion } = estado;
	if (!egresada || !fechaEgresoClarion) return estado;

	const ymd = fechaYmd || fechaCalendarioArgentina();
	const hora =
		typeof horaHms === 'string' && horaHms.trim()
			? horaHms.trim()
			: horaWallArgentina(true);

	const fechaCargaClarion = convertirFechaAClarion(ymd);
	let horaCargaClarion = 0;
	try {
		horaCargaClarion = convertirHoraAClarion(
			hora.includes(':') && hora.split(':').length === 2 ? `${hora}:00` : hora,
		);
	} catch {
		horaCargaClarion = convertirHoraAClarion(horaWallArgentina(true));
	}

	if (fechaCargaClarion < fechaEgresoClarion) return estado;
	if (
		fechaCargaClarion === fechaEgresoClarion &&
		horaCargaClarion < (horaEgresoClarion || Number.MAX_SAFE_INTEGER)
	) {
		return estado;
	}

	const err = new Error(
		'La visita está egresada: solo se pueden agregar registros con fecha/hora anteriores al egreso.',
	);
	err.statusCode = 409;
	throw err;
}

module.exports = {
	obtenerEstadoVisita,
	assertVisitaSinEgreso,
	assertCargaAntesDeEgreso,
};
