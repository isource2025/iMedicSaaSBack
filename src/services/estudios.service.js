const { executeQuery } = require('../models/db');

const CAMPOS_BASE = `
  IdPedido,
  IdVisita,
  FechaPedido,
  FechaPedidoISO,
  HoraPedido,
  IdTipoPedido,
  TipoPedidoDescripcion,
  CodigoPractica,
  PracticaSolicitada,
  NomencladorDescripcion,
  NotasObservacion,
  MatriculaSolicitante,
  MedicoSolicitanteNombre,
  IdProtocolo,
  EstadoUrgencia,
  SectorSolicitante,
  SectorSolicitanteNombre,
  SectorReceptor,
  SectorReceptorNombre,
  ServicioCodigo,
  ServicioDescripcion,
  CategoriaPedido
`;

const LISTAR_SQL = `
  SELECT ${CAMPOS_BASE}
  FROM dbo.vw_iMedic_PedidosEstudiosImagen
  WHERE IdVisita = @p0
  ORDER BY FechaPedido DESC
`;

const OBTENER_SQL = `
  SELECT ${CAMPOS_BASE}
  FROM dbo.vw_iMedic_PedidosEstudiosBase
  WHERE IdPedido = @p0
`;

async function listarPorVisita(idVisita) {
	return executeQuery(LISTAR_SQL, [{ value: idVisita, type: 'Int' }]);
}

async function obtenerPorId(idPedido) {
	const rows = await executeQuery(OBTENER_SQL, [{ value: idPedido, type: 'Int' }]);
	return rows?.[0] || null;
}

module.exports = { listarPorVisita, obtenerPorId };
