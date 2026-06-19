const { executeQuery } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');

const LEGACY_LISTAR_SQL = `
  SELECT
    IdPedido,
    IdVisita,
    FechaPedidoISO AS FechaSolicitud,
    HoraPedido AS HoraSolicitud,
    ISNULL(SectorReceptorNombre, SectorReceptor) AS Especialidad,
    MatriculaSolicitante AS MedicoSolicitante,
    MedicoSolicitanteNombre,
    NotasObservacion AS Motivo,
    ISNULL(EstadoUrgencia, 'PENDIENTE') AS Estado,
    IdProtocolo,
    SectorReceptor,
    SectorReceptorNombre,
    'LEGACY' AS Origen
  FROM dbo.vw_iMedic_PedidosInterconsultas
  WHERE IdVisita = @p0
  ORDER BY FechaPedido DESC
`;

const NUEVAS_LISTAR_SQL = `
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
      ELSE CONVERT(varchar(10), DATEADD(day, ic.FechaRespuesta, '1800-12-28'), 23) END AS FechaRespuesta,
    NULL AS IdProtocolo,
    NULL AS SectorReceptor,
    NULL AS SectorReceptorNombre,
    'WEB' AS Origen
  FROM dbo.imHCInterconsulta ic
  LEFT JOIN dbo.imPersonal per ON per.Matricula = ic.MedicoSolicitante
  WHERE ic.IdVisita = @p0
  ORDER BY ic.FechaSolicitud DESC, ic.HoraSolicitud DESC
`;

async function listarPorVisita(idVisita) {
	const [legacy, nuevas] = await Promise.all([
		executeQuery(LEGACY_LISTAR_SQL, [{ value: idVisita, type: 'Int' }]),
		executeQuery(NUEVAS_LISTAR_SQL, [{ value: idVisita, type: 'Int' }]).catch(() => []),
	]);

	const mappedLegacy = (legacy || []).map((r) => ({
		IdInterconsulta: r.IdPedido,
		IdVisita: r.IdVisita,
		FechaSolicitud: r.FechaSolicitud,
		HoraSolicitud: r.HoraSolicitud,
		Especialidad: r.Especialidad,
		MedicoSolicitante: r.MedicoSolicitante,
		MedicoSolicitanteNombre: r.MedicoSolicitanteNombre,
		Motivo: r.Motivo,
		Estado: r.Estado,
		IdProtocolo: r.IdProtocolo,
		SectorReceptor: r.SectorReceptor,
		Origen: r.Origen,
	}));

	const combined = [...mappedLegacy, ...(nuevas || [])];
	combined.sort((a, b) => {
		const da = `${a.FechaSolicitud || ''} ${a.HoraSolicitud || ''}`;
		const db = `${b.FechaSolicitud || ''} ${b.HoraSolicitud || ''}`;
		return db.localeCompare(da);
	});

	return combined;
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
