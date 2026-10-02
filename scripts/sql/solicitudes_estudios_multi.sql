/*
  Solicitudes de estudios con varias practicas (1 solicitud = N practicas).

  - Idempotente: se puede ejecutar cuantas veces haga falta.
  - Solo AGREGA (tabla nueva + columna NULL + indices). No modifica ni borra datos.
  - Compatible SQL Server 2008 (nivel de compatibilidad 100): sin CREATE OR ALTER, sin THROW,
    sin indices filtrados (evita problemas de QUOTED_IDENTIFIER con el ODBC de iMedic escritorio).
  - iMedic escritorio (Clarion) no conoce la columna nueva: al ser NULL no le afecta.

  El backend aplica exactamente lo mismo por su cuenta la primera vez que se usa
  /api/solicitudes-estudios (o via super admin:
  POST /api/super-admin/empresas/:id/migraciones/solicitudes-estudios).
  Este script existe para correrlo a mano en SSMS si se prefiere.
*/

-- 1) Cabecera de la solicitud
IF OBJECT_ID(N'dbo.imSolicitudesEstudios', N'U') IS NULL
CREATE TABLE dbo.imSolicitudesEstudios (
  IdSolicitud         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_imSolicitudesEstudios PRIMARY KEY,
  IdVisita            INT NOT NULL,
  FechaSolicitud      DATETIME NOT NULL CONSTRAINT DF_imSolicitudesEstudios_Fecha DEFAULT (GETDATE()),
  ValorProfesional    INT NULL,
  IdSectorSolicitante VARCHAR(4) NULL,
  IdSectorReceptor    VARCHAR(4) NULL,
  EstadoUrgencia      VARCHAR(12) NULL,
  NotasObservacion    VARCHAR(5000) NOT NULL CONSTRAINT DF_imSolicitudesEstudios_Notas DEFAULT ('')
);
GO

-- 2) Cada practica sigue siendo una fila de imPedidosEstudios; se agrupa por IdSolicitud.
--    Los pedidos existentes quedan con IdSolicitud NULL (= solicitud de 1 practica).
IF COL_LENGTH(N'dbo.imPedidosEstudios', N'IdSolicitud') IS NULL
ALTER TABLE dbo.imPedidosEstudios ADD IdSolicitud INT NULL;
GO

-- 3) Indices (imPedidosEstudios hoy solo tiene la PK)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_IdSolicitud' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios'))
CREATE NONCLUSTERED INDEX IX_imPedidosEstudios_IdSolicitud ON dbo.imPedidosEstudios (IdSolicitud);
GO

-- Bandeja del servicio receptor: pendientes por servicio, mas nuevos primero.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_Receptor_Protocolo' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios'))
CREATE NONCLUSTERED INDEX IX_imPedidosEstudios_Receptor_Protocolo
ON dbo.imPedidosEstudios (IdSectorReceptor, IdProtocolo, FechaPedido DESC, IdPedido DESC)
INCLUDE (IdTipoPedido, IdSolicitud);
GO

-- Listado por visita (pantalla del paciente)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imPedidosEstudios_IdVisita' AND object_id = OBJECT_ID(N'dbo.imPedidosEstudios'))
CREATE NONCLUSTERED INDEX IX_imPedidosEstudios_IdVisita ON dbo.imPedidosEstudios (IdVisita);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_imSolicitudesEstudios_IdVisita' AND object_id = OBJECT_ID(N'dbo.imSolicitudesEstudios'))
CREATE NONCLUSTERED INDEX IX_imSolicitudesEstudios_IdVisita ON dbo.imSolicitudesEstudios (IdVisita);
GO

-- Verificacion
SELECT
  CASE WHEN OBJECT_ID(N'dbo.imSolicitudesEstudios', N'U') IS NULL THEN 'FALTA' ELSE 'ok' END AS tablaCabecera,
  CASE WHEN COL_LENGTH(N'dbo.imPedidosEstudios', N'IdSolicitud') IS NULL THEN 'FALTA' ELSE 'ok' END AS columnaIdSolicitud,
  (SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.imPedidosEstudios')
     AND name IN (N'IX_imPedidosEstudios_IdSolicitud', N'IX_imPedidosEstudios_Receptor_Protocolo', N'IX_imPedidosEstudios_IdVisita')) AS indices_pedidos_de_3,
  (SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.imSolicitudesEstudios')
     AND name = N'IX_imSolicitudesEstudios_IdVisita') AS indice_cabecera_de_1;
GO
