/*
  Módulo Almacén / Abastecimiento — Hospital (SQL Server tenant)
  Flujo: Solicitud de Provisión → Orden de Provisión → Acta de Recepción → Stock
  Ejecutar en la BD del tenant.
*/

IF OBJECT_ID('dbo.imAlmacenArticulo', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenArticulo (
    IdArticulo      INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo          NVARCHAR(50)  NOT NULL,
    Descripcion     NVARCHAR(300) NOT NULL,
    UnidadMedida    NVARCHAR(50)  NULL,
    StockMinimo     DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenArticulo_StockMin DEFAULT (0),
    Activo          BIT           NOT NULL CONSTRAINT DF_imAlmacenArticulo_Activo DEFAULT (1),
    Observaciones   NVARCHAR(500) NULL,
    FechaAlta       DATETIME2     NOT NULL CONSTRAINT DF_imAlmacenArticulo_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta        NVARCHAR(50)  NULL,
    CONSTRAINT UQ_imAlmacenArticulo_Codigo UNIQUE (Codigo)
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenProveedor', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenProveedor (
    IdProveedor   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    RazonSocial   NVARCHAR(200) NOT NULL,
    CUIT          NVARCHAR(20)  NULL,
    Direccion     NVARCHAR(200) NULL,
    Telefono      NVARCHAR(50)  NULL,
    Email         NVARCHAR(100) NULL,
    Activo        BIT           NOT NULL CONSTRAINT DF_imAlmacenProveedor_Activo DEFAULT (1),
    FechaAlta     DATETIME2     NOT NULL CONSTRAINT DF_imAlmacenProveedor_Fecha DEFAULT (SYSUTCDATETIME())
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenDeposito', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenDeposito (
    IdDeposito  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo      NVARCHAR(20)  NOT NULL,
    Nombre      NVARCHAR(100) NOT NULL,
    EsPrincipal BIT           NOT NULL CONSTRAINT DF_imAlmacenDeposito_Prin DEFAULT (0),
    Activo      BIT           NOT NULL CONSTRAINT DF_imAlmacenDeposito_Activo DEFAULT (1),
    CONSTRAINT UQ_imAlmacenDeposito_Codigo UNIQUE (Codigo)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenDeposito WHERE Codigo = N'AG')
BEGIN
  INSERT INTO dbo.imAlmacenDeposito (Codigo, Nombre, EsPrincipal, Activo)
  VALUES (N'AG', N'Almacén General del Hospital', 1, 1);
END
GO

IF OBJECT_ID('dbo.imAlmacenStock', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenStock (
    IdStock           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdArticulo        INT           NOT NULL,
    IdDeposito        INT           NOT NULL,
    Lote              NVARCHAR(50)  NOT NULL CONSTRAINT DF_imAlmacenStock_Lote DEFAULT (N''),
    Cantidad          DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenStock_Cant DEFAULT (0),
    FechaVencimiento  DATE          NULL,
    CONSTRAINT UQ_imAlmacenStock UNIQUE (IdArticulo, IdDeposito, Lote),
    CONSTRAINT FK_imAlmacenStock_Art FOREIGN KEY (IdArticulo) REFERENCES dbo.imAlmacenArticulo(IdArticulo),
    CONSTRAINT FK_imAlmacenStock_Dep FOREIGN KEY (IdDeposito) REFERENCES dbo.imAlmacenDeposito(IdDeposito)
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenMovimiento', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenMovimiento (
    IdMovimiento     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Tipo             NVARCHAR(20)  NOT NULL,
    IdArticulo       INT           NOT NULL,
    IdDeposito       INT           NOT NULL,
    Lote             NVARCHAR(50)  NOT NULL CONSTRAINT DF_imAlmacenMov_Lote DEFAULT (N''),
    Cantidad         DECIMAL(18,4) NOT NULL,
    SaldoResultante  DECIMAL(18,4) NULL,
    IdDocumento      INT           NULL,
    TipoDocumento    NVARCHAR(30)  NULL,
    Observaciones    NVARCHAR(500) NULL,
    Fecha            DATETIME2     NOT NULL CONSTRAINT DF_imAlmacenMov_Fecha DEFAULT (SYSUTCDATETIME()),
    Operador         NVARCHAR(50)  NULL,
    CONSTRAINT FK_imAlmacenMov_Art FOREIGN KEY (IdArticulo) REFERENCES dbo.imAlmacenArticulo(IdArticulo),
    CONSTRAINT FK_imAlmacenMov_Dep FOREIGN KEY (IdDeposito) REFERENCES dbo.imAlmacenDeposito(IdDeposito)
  );
  CREATE INDEX IX_imAlmacenMovimiento_Fecha ON dbo.imAlmacenMovimiento (Fecha DESC);
END
GO

IF OBJECT_ID('dbo.imAlmacenSolicitud', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenSolicitud (
    IdSolicitud      INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroPedido        NVARCHAR(50)  NOT NULL,
    FechaPedido      DATE          NOT NULL,
    FechaEmision     DATE          NULL,
    Destino          NVARCHAR(100) NULL,
    Justificacion    NVARCHAR(500) NULL,
    Estado           NVARCHAR(30)  NOT NULL CONSTRAINT DF_imAlmacenSol_Estado DEFAULT (N'BORRADOR'),
    Solicitante      NVARCHAR(100) NULL,
    Aprobador        NVARCHAR(100) NULL,
    FechaAprobacion  DATETIME2     NULL,
    CostoEstimado    DECIMAL(18,2) NULL,
    Fondo            NVARCHAR(50)  NULL,
    Observaciones    NVARCHAR(500) NULL,
    FechaAlta        DATETIME2     NOT NULL CONSTRAINT DF_imAlmacenSol_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta         NVARCHAR(50)  NULL,
    CONSTRAINT UQ_imAlmacenSolicitud_Nro UNIQUE (NroPedido)
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenSolicitudItem', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenSolicitudItem (
    IdItem         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdSolicitud    INT           NOT NULL,
    Renglon        INT           NOT NULL,
    IdArticulo     INT           NULL,
    Codigo         NVARCHAR(50)  NULL,
    Descripcion    NVARCHAR(300) NOT NULL,
    Observaciones  NVARCHAR(200) NULL,
    Cantidad       DECIMAL(18,4) NOT NULL,
    CONSTRAINT FK_imAlmacenSolItem_Sol FOREIGN KEY (IdSolicitud)
      REFERENCES dbo.imAlmacenSolicitud(IdSolicitud) ON DELETE CASCADE
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenOrden', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenOrden (
    IdOrden          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroOrden         NVARCHAR(50)  NOT NULL,
    IdSolicitud      INT           NULL,
    NroExpediente    NVARCHAR(50)  NULL,
    NroConcurso      NVARCHAR(50)  NULL,
    NroAdjudicacion  NVARCHAR(50)  NULL,
    NroAutorizacion  NVARCHAR(50)  NULL,
    TipoOperacion    NVARCHAR(50)  NULL,
    CondPago         NVARCHAR(50)  NULL,
    FechaInvitacion  DATE          NULL,
    LugarEntrega     NVARCHAR(200) NULL,
    IdProveedor      INT           NULL,
    IdDeposito       INT           NULL,
    Estado           NVARCHAR(30)  NOT NULL CONSTRAINT DF_imAlmacenOrd_Estado DEFAULT (N'EMITIDA'),
    Total            DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenOrd_Total DEFAULT (0),
    Observaciones    NVARCHAR(500) NULL,
    FechaAlta        DATETIME2     NOT NULL CONSTRAINT DF_imAlmacenOrd_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta         NVARCHAR(50)  NULL,
    CONSTRAINT UQ_imAlmacenOrden_Nro UNIQUE (NroOrden),
    CONSTRAINT FK_imAlmacenOrden_Sol FOREIGN KEY (IdSolicitud) REFERENCES dbo.imAlmacenSolicitud(IdSolicitud),
    CONSTRAINT FK_imAlmacenOrden_Prov FOREIGN KEY (IdProveedor) REFERENCES dbo.imAlmacenProveedor(IdProveedor),
    CONSTRAINT FK_imAlmacenOrden_Dep FOREIGN KEY (IdDeposito) REFERENCES dbo.imAlmacenDeposito(IdDeposito)
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenOrdenItem', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenOrdenItem (
    IdItem            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdOrden           INT           NOT NULL,
    Renglon           INT           NOT NULL,
    IdArticulo        INT           NULL,
    Descripcion       NVARCHAR(300) NOT NULL,
    Observaciones     NVARCHAR(200) NULL,
    Cantidad          DECIMAL(18,4) NOT NULL,
    PrecioUnitario    DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenOrdItem_PU DEFAULT (0),
    Subtotal          DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenOrdItem_ST DEFAULT (0),
    CantidadRecibida  DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenOrdItem_CR DEFAULT (0),
    CONSTRAINT FK_imAlmacenOrdItem_Ord FOREIGN KEY (IdOrden)
      REFERENCES dbo.imAlmacenOrden(IdOrden) ON DELETE CASCADE
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenActa', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenActa (
    IdActa         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroActa        NVARCHAR(50)  NOT NULL,
    Fecha          DATE          NOT NULL,
    IdOrden        INT           NOT NULL,
    NroExpediente  NVARCHAR(50)  NULL,
    IdProveedor    INT           NULL,
    IdDeposito     INT           NOT NULL,
    Descuento      DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenActa_Desc DEFAULT (0),
    Total          DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenActa_Total DEFAULT (0),
    NroFactura     NVARCHAR(50)  NULL,
    Estado         NVARCHAR(30)  NOT NULL CONSTRAINT DF_imAlmacenActa_Estado DEFAULT (N'CONFIRMADA'),
    Observaciones  NVARCHAR(500) NULL,
    FechaAlta      DATETIME2     NOT NULL CONSTRAINT DF_imAlmacenActa_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta       NVARCHAR(50)  NULL,
    CONSTRAINT UQ_imAlmacenActa_Nro UNIQUE (NroActa),
    CONSTRAINT FK_imAlmacenActa_Orden FOREIGN KEY (IdOrden) REFERENCES dbo.imAlmacenOrden(IdOrden),
    CONSTRAINT FK_imAlmacenActa_Prov FOREIGN KEY (IdProveedor) REFERENCES dbo.imAlmacenProveedor(IdProveedor),
    CONSTRAINT FK_imAlmacenActa_Dep FOREIGN KEY (IdDeposito) REFERENCES dbo.imAlmacenDeposito(IdDeposito)
  );
END
GO

IF OBJECT_ID('dbo.imAlmacenActaItem', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.imAlmacenActaItem (
    IdItem          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdActa          INT           NOT NULL,
    Renglon         INT           NOT NULL,
    IdArticulo      INT           NULL,
    IdOrdenItem     INT           NULL,
    Descripcion     NVARCHAR(300) NOT NULL,
    Marca           NVARCHAR(100) NULL,
    Lote            NVARCHAR(50)  NULL,
    Cantidad        DECIMAL(18,4) NOT NULL,
    PrecioUnitario  DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenActaItem_PU DEFAULT (0),
    PrecioTotal     DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenActaItem_PT DEFAULT (0),
    CONSTRAINT FK_imAlmacenActaItem_Acta FOREIGN KEY (IdActa)
      REFERENCES dbo.imAlmacenActa(IdActa) ON DELETE CASCADE
  );
END
GO
