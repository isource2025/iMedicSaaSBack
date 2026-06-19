-- Vistas para pedidos de estudios (imagen/diagnóstico) e interconsultas
-- Fuente: imPedidosEstudios + imTiposPedidosEstudios, imNomenclador, imServicios,
--         imPersonal, imSectores
-- Interconsulta: IdTipoPedido = 33 (código práctica 420303)

IF OBJECT_ID(N'dbo.vw_iMedic_PedidosEstudiosBase', N'V') IS NOT NULL
  DROP VIEW dbo.vw_iMedic_PedidosEstudiosBase;
GO

CREATE VIEW dbo.vw_iMedic_PedidosEstudiosBase AS
SELECT
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
  CASE WHEN pe.IdTipoPedido = 33 THEN 'INTERCONSULTA' ELSE 'ESTUDIO' END AS CategoriaPedido
FROM dbo.imPedidosEstudios pe
LEFT JOIN dbo.imTiposPedidosEstudios tp ON tp.IdTipoPedido = pe.IdTipoPedido
LEFT JOIN dbo.imNomenclador nom ON nom.IDPractica = pe.IdPractica
LEFT JOIN dbo.imPersonal per ON per.Matricula = pe.ValorProfesional
LEFT JOIN dbo.imSectores secSol ON LTRIM(RTRIM(secSol.Valor)) = LTRIM(RTRIM(pe.IdSectorSolicitante))
LEFT JOIN dbo.imSectores secRec ON LTRIM(RTRIM(secRec.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor))
LEFT JOIN dbo.imServicios srv ON LTRIM(RTRIM(srv.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor));
GO

IF OBJECT_ID(N'dbo.vw_iMedic_PedidosEstudiosImagen', N'V') IS NOT NULL
  DROP VIEW dbo.vw_iMedic_PedidosEstudiosImagen;
GO

CREATE VIEW dbo.vw_iMedic_PedidosEstudiosImagen AS
SELECT *
FROM dbo.vw_iMedic_PedidosEstudiosBase
WHERE IdTipoPedido IS NULL OR IdTipoPedido <> 33;
GO

IF OBJECT_ID(N'dbo.vw_iMedic_PedidosInterconsultas', N'V') IS NOT NULL
  DROP VIEW dbo.vw_iMedic_PedidosInterconsultas;
GO

CREATE VIEW dbo.vw_iMedic_PedidosInterconsultas AS
SELECT *
FROM dbo.vw_iMedic_PedidosEstudiosBase
WHERE IdTipoPedido = 33;
GO
