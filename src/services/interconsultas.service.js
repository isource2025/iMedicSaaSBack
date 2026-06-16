const { executeQuery } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');

async function listarPorVisita(idVisita) {
	const sql = `
    SELECT
      ic.IdInterconsulta,
      ic.IdVisita,
      CONVERT(varchar(10), DATEADD(day, ic.FechaSolicitud, '1800-12-28'), 23) AS FechaSolicitud,
      CONVERT(varchar(5), DATEADD(ms, (ISNULL(ic.HoraSolicitud, 1) - 1) * 10, 0), 108) AS HoraSolicitud,
      ic.Especialidad,
      ic.MedicoSolicitante,
      per.ApellidoNombre AS MedicoSolicitanteNombre,
      ic.Motivo,
      ic.Estado,
      ic.Respuesta,
      CASE WHEN ic.FechaRespuesta IS NULL THEN NULL
        ELSE CONVERT(varchar(10), DATEADD(day, ic.FechaRespuesta, '1800-12-28'), 23) END AS FechaRespuesta
    FROM dbo.imHCInterconsulta ic
    LEFT JOIN dbo.imPersonal per ON per.Matricula = ic.MedicoSolicitante
    WHERE ic.IdVisita = @p0
    ORDER BY ic.FechaSolicitud DESC, ic.HoraSolicitud DESC
  `;
	return executeQuery(sql, [{ value: idVisita, type: 'Int' }]);
}

async function crear(data) {
	const fechaClarion = convertirFechaAClarion(data.FechaSolicitud);
	const horaClarion = data.HoraSolicitud ? convertirHoraAClarion(data.HoraSolicitud) : 1;
	const motivo = normalizarTextoParaClarionAnsi(String(data.Motivo || '').trim());
	const esp = normalizarTextoParaClarionAnsi(String(data.Especialidad || '').trim());

	const sql = `
    INSERT INTO dbo.imHCInterconsulta
      (IdVisita, FechaSolicitud, HoraSolicitud, Especialidad, MedicoSolicitante, Motivo, Estado)
    OUTPUT INSERTED.IdInterconsulta
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, 'PENDIENTE')
  `;
	const rows = await executeQuery(sql, [
		{ value: Number(data.IdVisita), type: 'Int' },
		{ value: fechaClarion, type: 'Int' },
		{ value: horaClarion, type: 'Int' },
		{ value: esp, type: 'VarChar' },
		{ value: data.MedicoSolicitante != null ? Number(data.MedicoSolicitante) : null, type: 'Int' },
		{ value: motivo, type: 'VarChar' },
	]);
	return { IdInterconsulta: rows[0]?.IdInterconsulta };
}

module.exports = { listarPorVisita, crear };
