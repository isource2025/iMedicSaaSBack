const { executeQuery } = require('../models/db');

const LISTAR_SQL = `
  SELECT
    IdPedido,
    IdVisita,
    FechaPedido,
    FechaPedidoISO,
    HoraPedido,
    IdTipoPedido,
    CodigoPractica,
    PracticaSolicitada,
    NotasObservacion,
    MatriculaSolicitante,
    MedicoSolicitanteNombre,
    IdProtocolo,
    EstadoUrgencia,
    SectorSolicitante,
    SectorReceptor,
    SectorReceptorNombre
  FROM dbo.vw_iMedic_PedidosEstudiosImagen
  WHERE IdVisita = @p0
  ORDER BY FechaPedido DESC
`;

async function listarPorVisita(idVisita) {
	return executeQuery(LISTAR_SQL, [{ value: idVisita, type: 'Int' }]);
}

module.exports = { listarPorVisita };
