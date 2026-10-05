const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	filtroPeriodoClarion,
	fechaClarionHoyArgentina,
	horaClarionAhoraArgentina,
} = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi: toAnsi } = require('../utils/clarionText');
const { sqlApplyNombrePersona } = require('../utils/sqlNombrePersona');

/** Las filas que genera la indicación no traen FechaDieta: se ubican por la fecha de carga. */
const COL_FECHA = 'COALESCE(NULLIF(d.FechaDieta, 0), d.FechaCarga)';

const SELECT_DIETA = `
  SELECT
    d.Valor AS IdCtrlDieta,
    d.NumeroVisita,
    d.Nroindicacion AS NroIndicacion,
    d.TipoDieta,
    LTRIM(RTRIM(td.Descripcion)) AS DescripcionDieta,
    CONVERT(varchar(10), DATEADD(day, NULLIF(d.FechaDieta,0) - 4, '1801-01-01'), 23) AS FechaDieta,
    CONVERT(varchar(8), DATEADD(ms, (NULLIF(d.HoraDieta,0) - 1) * 10, 0), 108) AS HoraDieta,
    CONVERT(varchar(10), DATEADD(day, NULLIF(d.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCarga,
    CONVERT(varchar(8), DATEADD(ms, (NULLIF(d.HoraCarga,0) - 1) * 10, 0), 108) AS HoraCarga,
    d.Observaciones,
    d.OperadorCarga,
    op.NombreCompleto AS OperadorFullName,
    d.Profesional,
    COALESCE(prof.NombreCompleto, op.NombreCompleto) AS ProfesionalFullName,
    COALESCE(prof.Matricula, op.Matricula) AS Matricula
  FROM dbo.imInterCtrlDieta AS d
  LEFT JOIN dbo.imTipoDieta AS td ON td.Valor = d.TipoDieta
  ${sqlApplyNombrePersona('d.OperadorCarga', 'op')}
  ${sqlApplyNombrePersona('d.Profesional', 'prof', ['matricula', 'operador', 'valor'])}
`;

async function obtenerPorVisitaYFecha(numeroVisita, fecha, days) {
	const periodo = filtroPeriodoClarion(COL_FECHA, fecha, days, 1);
	const consulta = `
    ${SELECT_DIETA}
    WHERE d.NumeroVisita = @param0
      ${periodo.sql ? `AND ${periodo.sql}` : ''}
    ORDER BY ${COL_FECHA} ASC, COALESCE(NULLIF(d.HoraDieta, 0), d.HoraCarga) ASC, d.Valor ASC
  `;
	return executeQuery(consulta, [{ value: numeroVisita }, ...periodo.params]);
}

async function obtenerPorId(id) {
	const rows = await executeQuery(`${SELECT_DIETA} WHERE d.Valor = @param0`, [{ value: id }]);
	return rows[0] || null;
}

async function obtenerTiposDieta() {
	return executeQuery(`
    SELECT Valor, LTRIM(RTRIM(Descripcion)) AS Descripcion
    FROM dbo.imTipoDieta
    ORDER BY Descripcion
  `);
}

function tipoDieta(v) {
	const n = Number(v);
	if (v == null || v === '' || !Number.isInteger(n) || n < 0 || n > 255) {
		throw Object.assign(new Error('Tipo de dieta inválido'), { statusCode: 400 });
	}
	return n;
}

function fechaDieta(v) {
	const s = String(v || '').slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		throw Object.assign(new Error('Fecha de dieta inválida (YYYY-MM-DD)'), { statusCode: 400 });
	}
	return convertirFechaAClarion(s);
}

function horaDieta(v) {
	const s = String(v || '').trim();
	if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) {
		throw Object.assign(new Error('Hora de dieta inválida (HH:MM)'), { statusCode: 400 });
	}
	return convertirHoraAClarion(s.length === 5 ? `${s}:00` : s);
}

const observaciones = (v) => toAnsi(v == null ? '' : String(v)).slice(0, 255);

async function crear(data) {
	const numeroVisita = Number(data.numeroVisita);
	if (!Number.isInteger(numeroVisita) || numeroVisita <= 0) {
		throw Object.assign(new Error('Número de visita inválido'), { statusCode: 400 });
	}
	// Valor no es IDENTITY: el lock evita que dos altas simultáneas tomen el mismo número.
	const sql = `
    INSERT INTO dbo.imInterCtrlDieta (
      Valor, NumeroVisita, FechaCarga, HoraCarga, FechaDieta, HoraDieta,
      TipoDieta, Observaciones, Profesional, OperadorCarga, Nroindicacion
    )
    OUTPUT INSERTED.Valor
    SELECT ISNULL(MAX(Valor), 0) + 1, @param0, @param1, @param2, @param3, @param4,
           @param5, @param6, @param7, @param8, NULL
    FROM dbo.imInterCtrlDieta WITH (UPDLOCK, HOLDLOCK)
  `;
	const result = await executeQuery(sql, [
		{ value: numeroVisita },
		{ value: fechaClarionHoyArgentina() },
		{ value: horaClarionAhoraArgentina() },
		{ value: fechaDieta(data.fechaDieta) },
		{ value: horaDieta(data.horaDieta) },
		{ value: tipoDieta(data.tipoDieta) },
		{ value: observaciones(data.observaciones) },
		{ value: data.profesional ?? null },
		{ value: data.operadorCarga ?? null },
	]);
	const id = result?.[0]?.Valor;
	return id ? obtenerPorId(id) : null;
}

async function actualizar(id, data = {}) {
	const existing = await obtenerPorId(id);
	if (!existing) return null;
	await executeQuery(
		`
    UPDATE dbo.imInterCtrlDieta SET
      TipoDieta = @param1,
      FechaDieta = @param2,
      HoraDieta = @param3,
      Observaciones = @param4
    WHERE Valor = @param0
  `,
		[
			{ value: Number(id) },
			{ value: tipoDieta(data.tipoDieta ?? existing.TipoDieta) },
			{ value: fechaDieta(data.fechaDieta ?? existing.FechaDieta ?? existing.FechaCarga) },
			{ value: horaDieta(data.horaDieta ?? existing.HoraDieta ?? existing.HoraCarga) },
			{ value: observaciones(data.observaciones ?? existing.Observaciones) },
		],
	);
	return obtenerPorId(id);
}

async function eliminar(id) {
	await executeQuery('DELETE FROM dbo.imInterCtrlDieta WHERE Valor = @param0', [
		{ value: Number(id) },
	]);
	return true;
}

module.exports = {
	obtenerPorVisitaYFecha,
	obtenerPorId,
	obtenerTiposDieta,
	crear,
	actualizar,
	eliminar,
};
