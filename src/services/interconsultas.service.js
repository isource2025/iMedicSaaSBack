const estudiosService = require('./estudios.service');
const { executeQuery } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');

/** Código canónico en imTiposPedidosEstudios (práctica 420303 INTERCONSULTA). */
const ID_TIPO_INTERCONSULTA = 33;

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

const CAMPOS_LEGACY = `
  IdPedido,
  IdVisita,
  FechaPedidoISO AS FechaSolicitud,
  HoraPedido AS HoraSolicitud,
  IdTipoPedido,
  TipoPedidoDescripcion,
  CodigoPractica,
  PracticaSolicitada,
  NomencladorDescripcion,
  ISNULL(SectorReceptorNombre, ISNULL(ServicioDescripcion, SectorReceptor)) AS Especialidad,
  MatriculaSolicitante AS MedicoSolicitante,
  MedicoSolicitanteNombre,
  NotasObservacion AS Motivo,
  ISNULL(EstadoUrgencia, 'PENDIENTE') AS Estado,
  IdProtocolo,
  SectorSolicitante,
  SectorSolicitanteNombre,
  SectorReceptor,
  SectorReceptorNombre,
  ServicioCodigo,
  ServicioDescripcion,
  EstadoUrgencia,
  CategoriaPedido
`;

const LEGACY_LISTAR_SQL = `
  SELECT ${CAMPOS_LEGACY}, 'LEGACY' AS Origen
  FROM dbo.vw_iMedic_PedidosInterconsultas
  WHERE IdVisita = @p0
  ORDER BY FechaPedido DESC
`;

const LEGACY_OBTENER_SQL = `
  SELECT ${CAMPOS_LEGACY}, 'LEGACY' AS Origen
  FROM dbo.vw_iMedic_PedidosInterconsultas
  WHERE IdPedido = @p0
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
    NULL AS IdTipoPedido,
    NULL AS CodigoPractica,
    NULL AS EstadoUrgencia,
    'WEB' AS Origen
  FROM dbo.imHCInterconsulta ic
  LEFT JOIN dbo.imPersonal per ON per.Matricula = ic.MedicoSolicitante
  WHERE ic.IdVisita = @p0
  ORDER BY ic.FechaSolicitud DESC, ic.HoraSolicitud DESC
`;

const NUEVA_OBTENER_SQL = `
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
    NULL AS IdTipoPedido,
    NULL AS CodigoPractica,
    NULL AS EstadoUrgencia,
    'WEB' AS Origen
  FROM dbo.imHCInterconsulta ic
  LEFT JOIN dbo.imPersonal per ON per.Matricula = ic.MedicoSolicitante
  WHERE ic.IdInterconsulta = @p0
`;

function mapLegacyRow(r) {
	return {
		IdInterconsulta: r.IdPedido,
		IdPedido: r.IdPedido,
		IdVisita: r.IdVisita,
		FechaSolicitud: r.FechaSolicitud,
		HoraSolicitud: r.HoraSolicitud,
		IdTipoPedido: r.IdTipoPedido,
		TipoPedidoDescripcion: r.TipoPedidoDescripcion,
		CodigoPractica: r.CodigoPractica,
		PracticaSolicitada: r.PracticaSolicitada,
		NomencladorDescripcion: r.NomencladorDescripcion,
		Especialidad: r.Especialidad,
		MedicoSolicitante: r.MedicoSolicitante,
		MedicoSolicitanteNombre: r.MedicoSolicitanteNombre,
		Motivo: r.Motivo,
		Estado: r.Estado,
		EstadoUrgencia: r.EstadoUrgencia,
		IdProtocolo: r.IdProtocolo,
		SectorSolicitante: r.SectorSolicitante,
		SectorSolicitanteNombre: r.SectorSolicitanteNombre,
		SectorReceptor: r.SectorReceptor,
		SectorReceptorNombre: r.SectorReceptorNombre,
		ServicioCodigo: r.ServicioCodigo,
		ServicioDescripcion: r.ServicioDescripcion,
		Origen: r.Origen || 'LEGACY',
	};
}

function mapPedidoToInterconsulta(p) {
	const cumplido = !!p.Cumplido;
	const tomado = !!p.Tomado;
	return {
		IdInterconsulta: p.IdPedido,
		IdPedido: p.IdPedido,
		IdVisita: p.IdVisita,
		FechaSolicitud: p.FechaPedidoISO,
		HoraSolicitud: p.HoraPedido,
		IdTipoPedido: p.IdTipoPedido,
		TipoPedidoDescripcion: p.TipoPedidoDescripcion,
		CodigoPractica: p.CodigoPractica,
		PracticaSolicitada: p.PracticaSolicitada,
		NomencladorDescripcion: p.NomencladorDescripcion,
		Especialidad: p.ServicioDescripcion || p.SectorReceptorNombre || p.SectorReceptor,
		MedicoSolicitante: p.MatriculaSolicitante,
		MedicoSolicitanteNombre: p.MedicoSolicitanteNombre,
		Motivo: p.NotasObservacion || '',
		Estado: cumplido ? 'CUMPLIDO' : tomado ? 'TOMADO' : p.EstadoUrgencia || 'PENDIENTE',
		EstadoUrgencia: p.EstadoUrgencia,
		Respuesta: p.TextoResultado || null,
		FechaRespuesta: p.FechaResultado || null,
		IdProtocolo: p.IdProtocolo,
		SectorSolicitante: p.SectorSolicitante,
		SectorSolicitanteNombre: p.SectorSolicitanteNombre,
		SectorReceptor: p.SectorReceptor,
		SectorReceptorNombre: p.SectorReceptorNombre,
		ServicioCodigo: p.ServicioCodigo,
		ServicioDescripcion: p.ServicioDescripcion,
		Tomado: tomado,
		MatriculaToma: p.MatriculaToma,
		NombreToma: p.NombreToma,
		Cumplido: cumplido,
		EstadoWorkflow: p.EstadoWorkflow,
		Origen: 'LEGACY',
	};
}

async function listarSectoresDestino() {
	return estudiosService.listarSectoresReceptor();
}

async function listarPorVisita(idVisita) {
	const [legacy, nuevas] = await Promise.all([
		executeQuery(LEGACY_LISTAR_SQL, [{ value: idVisita, type: 'Int' }]).catch(() => []),
		executeQuery(NUEVAS_LISTAR_SQL, [{ value: idVisita, type: 'Int' }]).catch(() => []),
	]);

	const mappedLegacy = (legacy || []).map(mapLegacyRow);
	const combined = [...mappedLegacy, ...(nuevas || [])];
	combined.sort((a, b) => {
		const da = `${a.FechaSolicitud || ''} ${a.HoraSolicitud || ''}`;
		const db = `${b.FechaSolicitud || ''} ${b.HoraSolicitud || ''}`;
		return db.localeCompare(da);
	});

	return combined;
}

async function obtenerPorId(id, origen) {
	if (origen === 'WEB') {
		const rows = await executeQuery(NUEVA_OBTENER_SQL, [{ value: id, type: 'Int' }]);
		return rows?.[0] || null;
	}

	const pedido = await estudiosService.obtenerPorId(id);
	if (pedido && Number(pedido.IdTipoPedido) === ID_TIPO_INTERCONSULTA) {
		return mapPedidoToInterconsulta(pedido);
	}

	const rows = await executeQuery(LEGACY_OBTENER_SQL, [{ value: id, type: 'Int' }]);
	const row = rows?.[0];
	return row ? mapLegacyRow(row) : null;
}

/**
 * Crea interconsulta en imPedidosEstudios (IdTipoPedido = 33) con servicio destino.
 */
async function crear({
	idVisita,
	matriculaSolicitante,
	sectorSolicitante,
	idSectorReceptor,
	motivo,
	estadoUrgencia,
}) {
	const receptor = String(idSectorReceptor || '').trim();
	if (!receptor) throw _httpError('El servicio destino es obligatorio');
	const notas = String(motivo || '').trim();
	if (!notas) throw _httpError('El motivo es obligatorio');

	const creado = await estudiosService.crearPedido({
		idVisita,
		matriculaSolicitante,
		sectorSolicitante,
		idTipoPedido: ID_TIPO_INTERCONSULTA,
		idSectorReceptor: receptor,
		notas,
		estadoUrgencia: estadoUrgencia || 'Normal',
	});

	const detalle = await obtenerPorId(creado.idPedido, 'LEGACY');
	return detalle || {
		IdInterconsulta: creado.idPedido,
		IdPedido: creado.idPedido,
		IdVisita: Number(idVisita),
		Origen: 'LEGACY',
	};
}

async function listarPendientesPorSector(sectorReceptor, { limit = 100 } = {}) {
	await estudiosService.ensureTomaTable();
	const sector = String(sectorReceptor || '').trim();
	if (!sector) throw _httpError('sector receptor requerido');

	const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
	const pad = String(sector).padEnd(4, ' ').slice(0, 4);

	const rows = await executeQuery(
		`SELECT TOP ${lim}
		  pe.IdPedido,
		  pe.IdVisita,
		  pe.FechaPedido,
		  CONVERT(varchar(10), pe.FechaPedido, 23) AS FechaPedidoISO,
		  CONVERT(varchar(5), pe.FechaPedido, 108) AS HoraPedido,
		  pe.IdTipoPedido,
		  LTRIM(RTRIM(ISNULL(tp.DescPractica, ''))) AS TipoPedidoDescripcion,
		  pe.IdPractica AS CodigoPractica,
		  LTRIM(RTRIM(ISNULL(tp.DescPractica, ''))) AS PracticaSolicitada,
		  LTRIM(RTRIM(ISNULL(nom.Descripcion, ''))) AS NomencladorDescripcion,
		  pe.NotasObservacion,
		  pe.ValorProfesional AS MatriculaSolicitante,
		  per.ApellidoNombre AS MedicoSolicitanteNombre,
		  pe.IdProtocolo,
		  pe.EstadoUrgencia,
		  LTRIM(RTRIM(ISNULL(pe.IdSectorSolicitante, ''))) AS SectorSolicitante,
		  secSol.Descripcion AS SectorSolicitanteNombre,
		  LTRIM(RTRIM(ISNULL(pe.IdSectorReceptor, ''))) AS SectorReceptor,
		  secRec.Descripcion AS SectorReceptorNombre,
		  LTRIM(RTRIM(ISNULL(srv.Valor, ''))) AS ServicioCodigo,
		  srv.Descripcion AS ServicioDescripcion,
		  'INTERCONSULTA' AS CategoriaPedido,
		  NULL AS TextoProtocolo,
		  NULL AS FechaResultado,
		  NULL AS PracticaFacturada,
		  NULL AS MatriculaRealizador,
		  NULL AS RealizadorNombre,
		  toma.Matricula AS MatriculaToma,
		  toma.FechaToma,
		  tomaPer.ApellidoNombre AS NombreToma
		 FROM dbo.imPedidosEstudios pe
		 LEFT JOIN dbo.imTiposPedidosEstudios tp ON tp.IdTipoPedido = pe.IdTipoPedido
		 LEFT JOIN dbo.imNomenclador nom ON nom.IDPractica = pe.IdPractica
		 LEFT JOIN dbo.imPersonal per ON per.Matricula = pe.ValorProfesional
		 LEFT JOIN dbo.imSectores secSol ON LTRIM(RTRIM(secSol.Valor)) = LTRIM(RTRIM(pe.IdSectorSolicitante))
		 LEFT JOIN dbo.imSectores secRec ON LTRIM(RTRIM(secRec.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor))
		 LEFT JOIN dbo.imServicios srv ON LTRIM(RTRIM(srv.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor))
		 LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
		 LEFT JOIN dbo.imPersonal tomaPer ON tomaPer.Matricula = toma.Matricula
		 WHERE LTRIM(RTRIM(pe.IdSectorReceptor)) = LTRIM(RTRIM(@p0))
		   AND pe.IdTipoPedido = ${ID_TIPO_INTERCONSULTA}
		   AND (pe.IdProtocolo IS NULL OR pe.IdProtocolo = 0)
		 ORDER BY
		   CASE WHEN pe.EstadoUrgencia = 'Urgente' THEN 0
		        WHEN pe.EstadoUrgencia = 'Medio' THEN 1
		        ELSE 2 END,
		   pe.FechaPedido ASC, pe.IdPedido ASC`,
		[{ value: pad, type: 'VarChar' }],
	);

	return (rows || []).map((row) => {
		const matriculaToma = row.MatriculaToma != null ? Number(row.MatriculaToma) : null;
		const tomado = Number.isFinite(matriculaToma) && matriculaToma > 0;
		return mapPedidoToInterconsulta({
			IdPedido: Number(row.IdPedido),
			IdVisita: Number(row.IdVisita),
			FechaPedidoISO: row.FechaPedidoISO,
			HoraPedido: row.HoraPedido,
			IdTipoPedido: row.IdTipoPedido,
			TipoPedidoDescripcion: row.TipoPedidoDescripcion,
			CodigoPractica: row.CodigoPractica,
			PracticaSolicitada: row.PracticaSolicitada,
			NomencladorDescripcion: row.NomencladorDescripcion,
			NotasObservacion: row.NotasObservacion,
			MatriculaSolicitante: row.MatriculaSolicitante,
			MedicoSolicitanteNombre: row.MedicoSolicitanteNombre,
			IdProtocolo: 0,
			Cumplido: false,
			EstadoUrgencia: row.EstadoUrgencia,
			SectorSolicitante: row.SectorSolicitante,
			SectorSolicitanteNombre: row.SectorSolicitanteNombre,
			SectorReceptor: row.SectorReceptor,
			SectorReceptorNombre: row.SectorReceptorNombre,
			ServicioCodigo: row.ServicioCodigo,
			ServicioDescripcion: row.ServicioDescripcion,
			TextoResultado: null,
			FechaResultado: null,
			Tomado: tomado,
			MatriculaToma: tomado ? matriculaToma : null,
			NombreToma: row.NombreToma,
			EstadoWorkflow: tomado ? 'TOMADO' : 'PENDIENTE',
		});
	});
}

async function tomar({ idPedido, matricula, codOperador }) {
	const ped = await estudiosService.obtenerPorId(idPedido);
	if (!ped || Number(ped.IdTipoPedido) !== ID_TIPO_INTERCONSULTA) {
		throw _httpError('Interconsulta no encontrada', 404);
	}
	await estudiosService.tomarPedido({ idPedido, matricula, codOperador });
	return obtenerPorId(idPedido, 'LEGACY');
}

async function liberar({ idPedido, matricula }) {
	const ped = await estudiosService.obtenerPorId(idPedido);
	if (!ped || Number(ped.IdTipoPedido) !== ID_TIPO_INTERCONSULTA) {
		throw _httpError('Interconsulta no encontrada', 404);
	}
	await estudiosService.liberarPedido({ idPedido, matricula });
	return obtenerPorId(idPedido, 'LEGACY');
}

async function cumplir({ idPedido, textoRespuesta, matriculaRealizador, codOperador, sectorServicio }) {
	const ped = await estudiosService.obtenerPorId(idPedido);
	if (!ped || Number(ped.IdTipoPedido) !== ID_TIPO_INTERCONSULTA) {
		throw _httpError('Interconsulta no encontrada', 404);
	}
	await estudiosService.cumplirPedido({
		idPedido,
		textoInforme: textoRespuesta,
		matriculaRealizador,
		codOperador,
		sectorServicio: sectorServicio || ped.SectorReceptor,
	});
	return obtenerPorId(idPedido, 'LEGACY');
}

/** @deprecated solo lectura de filas web antiguas; no usar para crear nuevas */
async function crearWebLegacy(data) {
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

module.exports = {
	ID_TIPO_INTERCONSULTA,
	listarPorVisita,
	obtenerPorId,
	crear,
	listarSectoresDestino,
	listarPendientesPorSector,
	tomar,
	liberar,
	cumplir,
	crearWebLegacy,
};
