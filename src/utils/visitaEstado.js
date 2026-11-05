/**
 * Estado de la visita (internada vs egresada) para gates de escritura clínica.
 */
const { executeQuery } = require('../models/db');

/**
 * @param {number|string|null|undefined} numeroVisita
 * @returns {Promise<{ egresada: boolean, fechaEgresoClarion: number }>}
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
			ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) AS fechaEgresoClarion
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
	};
}

/**
 * Bloquea altas clínicas cuando la visita ya tiene egreso.
 * @param {number|string|null|undefined} numeroVisita
 */
async function assertVisitaSinEgreso(numeroVisita) {
	const { egresada } = await obtenerEstadoVisita(numeroVisita);
	if (egresada) {
		const err = new Error(
			'La visita está egresada: no se pueden agregar registros clínicos.',
		);
		err.statusCode = 409;
		throw err;
	}
}

module.exports = {
	obtenerEstadoVisita,
	assertVisitaSinEgreso,
};
