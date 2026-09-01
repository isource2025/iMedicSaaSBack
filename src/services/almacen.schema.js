/**
 * Asegura el esquema del módulo Almacén en la BD del tenant.
 * Idempotente: puede ejecutarse en cada arranque / primera request.
 */
const { executeQuery } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');

const DDL = [
	`IF OBJECT_ID('dbo.imAlmacenArticulo', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenArticulo (
    IdArticulo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo NVARCHAR(50) NOT NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    UnidadMedida NVARCHAR(50) NULL,
    StockMinimo DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenArticulo_StockMin DEFAULT (0),
    Activo BIT NOT NULL CONSTRAINT DF_imAlmacenArticulo_Activo DEFAULT (1),
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_imAlmacenArticulo_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_imAlmacenArticulo_Codigo UNIQUE (Codigo)
  )`,
	`IF OBJECT_ID('dbo.imAlmacenProveedor', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenProveedor (
    IdProveedor INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    RazonSocial NVARCHAR(200) NOT NULL,
    CUIT NVARCHAR(20) NULL,
    Direccion NVARCHAR(200) NULL,
    Telefono NVARCHAR(50) NULL,
    Email NVARCHAR(100) NULL,
    Activo BIT NOT NULL CONSTRAINT DF_imAlmacenProveedor_Activo DEFAULT (1),
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_imAlmacenProveedor_Fecha DEFAULT (SYSUTCDATETIME())
  )`,
	`IF OBJECT_ID('dbo.imAlmacenDeposito', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenDeposito (
    IdDeposito INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo NVARCHAR(20) NOT NULL,
    Nombre NVARCHAR(100) NOT NULL,
    EsPrincipal BIT NOT NULL CONSTRAINT DF_imAlmacenDeposito_Prin DEFAULT (0),
    Activo BIT NOT NULL CONSTRAINT DF_imAlmacenDeposito_Activo DEFAULT (1),
    CONSTRAINT UQ_imAlmacenDeposito_Codigo UNIQUE (Codigo)
  )`,
	`IF OBJECT_ID('dbo.imAlmacenStock', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenStock (
    IdStock INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdArticulo INT NOT NULL,
    IdDeposito INT NOT NULL,
    Lote NVARCHAR(50) NOT NULL CONSTRAINT DF_imAlmacenStock_Lote DEFAULT (N''),
    Cantidad DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenStock_Cant DEFAULT (0),
    FechaVencimiento DATE NULL,
    CONSTRAINT UQ_imAlmacenStock UNIQUE (IdArticulo, IdDeposito, Lote),
    CONSTRAINT FK_imAlmacenStock_Art FOREIGN KEY (IdArticulo) REFERENCES dbo.imAlmacenArticulo(IdArticulo),
    CONSTRAINT FK_imAlmacenStock_Dep FOREIGN KEY (IdDeposito) REFERENCES dbo.imAlmacenDeposito(IdDeposito)
  )`,
	`IF OBJECT_ID('dbo.imAlmacenMovimiento', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenMovimiento (
    IdMovimiento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Tipo NVARCHAR(20) NOT NULL,
    IdArticulo INT NOT NULL,
    IdDeposito INT NOT NULL,
    Lote NVARCHAR(50) NOT NULL CONSTRAINT DF_imAlmacenMov_Lote DEFAULT (N''),
    Cantidad DECIMAL(18,4) NOT NULL,
    SaldoResultante DECIMAL(18,4) NULL,
    IdDocumento INT NULL,
    TipoDocumento NVARCHAR(30) NULL,
    Observaciones NVARCHAR(500) NULL,
    Fecha DATETIME2 NOT NULL CONSTRAINT DF_imAlmacenMov_Fecha DEFAULT (SYSUTCDATETIME()),
    Operador NVARCHAR(50) NULL
  )`,
	`IF OBJECT_ID('dbo.imAlmacenSolicitud', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenSolicitud (
    IdSolicitud INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroPedido NVARCHAR(50) NOT NULL,
    FechaPedido DATE NOT NULL,
    FechaEmision DATE NULL,
    Destino NVARCHAR(100) NULL,
    Justificacion NVARCHAR(500) NULL,
    Estado NVARCHAR(30) NOT NULL CONSTRAINT DF_imAlmacenSol_Estado DEFAULT (N'BORRADOR'),
    Solicitante NVARCHAR(100) NULL,
    Aprobador NVARCHAR(100) NULL,
    FechaAprobacion DATETIME2 NULL,
    CostoEstimado DECIMAL(18,2) NULL,
    Fondo NVARCHAR(50) NULL,
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_imAlmacenSol_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_imAlmacenSolicitud_Nro UNIQUE (NroPedido)
  )`,
	`IF OBJECT_ID('dbo.imAlmacenSolicitudItem', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenSolicitudItem (
    IdItem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdSolicitud INT NOT NULL,
    Renglon INT NOT NULL,
    IdArticulo INT NULL,
    Codigo NVARCHAR(50) NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    Observaciones NVARCHAR(200) NULL,
    Cantidad DECIMAL(18,4) NOT NULL,
    CONSTRAINT FK_imAlmacenSolItem_Sol FOREIGN KEY (IdSolicitud)
      REFERENCES dbo.imAlmacenSolicitud(IdSolicitud) ON DELETE CASCADE
  )`,
	`IF OBJECT_ID('dbo.imAlmacenOrden', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenOrden (
    IdOrden INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroOrden NVARCHAR(50) NOT NULL,
    IdSolicitud INT NULL,
    NroExpediente NVARCHAR(50) NULL,
    NroConcurso NVARCHAR(50) NULL,
    NroAdjudicacion NVARCHAR(50) NULL,
    NroAutorizacion NVARCHAR(50) NULL,
    TipoOperacion NVARCHAR(50) NULL,
    CondPago NVARCHAR(50) NULL,
    FechaInvitacion DATE NULL,
    LugarEntrega NVARCHAR(200) NULL,
    IdProveedor INT NULL,
    IdDeposito INT NULL,
    Estado NVARCHAR(30) NOT NULL CONSTRAINT DF_imAlmacenOrd_Estado DEFAULT (N'EMITIDA'),
    Total DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenOrd_Total DEFAULT (0),
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_imAlmacenOrd_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_imAlmacenOrden_Nro UNIQUE (NroOrden)
  )`,
	`IF OBJECT_ID('dbo.imAlmacenOrdenItem', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenOrdenItem (
    IdItem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdOrden INT NOT NULL,
    Renglon INT NOT NULL,
    IdArticulo INT NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    Observaciones NVARCHAR(200) NULL,
    Cantidad DECIMAL(18,4) NOT NULL,
    PrecioUnitario DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenOrdItem_PU DEFAULT (0),
    Subtotal DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenOrdItem_ST DEFAULT (0),
    CantidadRecibida DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenOrdItem_CR DEFAULT (0),
    CONSTRAINT FK_imAlmacenOrdItem_Ord FOREIGN KEY (IdOrden)
      REFERENCES dbo.imAlmacenOrden(IdOrden) ON DELETE CASCADE
  )`,
	`IF OBJECT_ID('dbo.imAlmacenActa', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenActa (
    IdActa INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroActa NVARCHAR(50) NOT NULL,
    Fecha DATE NOT NULL,
    IdOrden INT NOT NULL,
    NroExpediente NVARCHAR(50) NULL,
    IdProveedor INT NULL,
    IdDeposito INT NOT NULL,
    Descuento DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenActa_Desc DEFAULT (0),
    Total DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenActa_Total DEFAULT (0),
    NroFactura NVARCHAR(50) NULL,
    Estado NVARCHAR(30) NOT NULL CONSTRAINT DF_imAlmacenActa_Estado DEFAULT (N'CONFIRMADA'),
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_imAlmacenActa_Fecha DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_imAlmacenActa_Nro UNIQUE (NroActa)
  )`,
	`IF OBJECT_ID('dbo.imAlmacenActaItem', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenActaItem (
    IdItem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdActa INT NOT NULL,
    Renglon INT NOT NULL,
    IdArticulo INT NULL,
    IdOrdenItem INT NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    Marca NVARCHAR(100) NULL,
    Lote NVARCHAR(50) NULL,
    Cantidad DECIMAL(18,4) NOT NULL,
    PrecioUnitario DECIMAL(18,4) NOT NULL CONSTRAINT DF_imAlmacenActaItem_PU DEFAULT (0),
    PrecioTotal DECIMAL(18,2) NOT NULL CONSTRAINT DF_imAlmacenActaItem_PT DEFAULT (0),
    CONSTRAINT FK_imAlmacenActaItem_Acta FOREIGN KEY (IdActa)
      REFERENCES dbo.imAlmacenActa(IdActa) ON DELETE CASCADE
  )`,
	`IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenDeposito WHERE Codigo = N'AG')
  INSERT INTO dbo.imAlmacenDeposito (Codigo, Nombre, EsPrincipal, Activo)
  VALUES (N'AG', N'Almacén General del Hospital', 1, 1)`,
	// Farmacia: depósito intermedio hacia el servicio (no es el punto de compra)
	`IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenDeposito WHERE Codigo = N'FAR')
  INSERT INTO dbo.imAlmacenDeposito (Codigo, Nombre, EsPrincipal, Activo)
  VALUES (N'FAR', N'Farmacia', 0, 1)`,
	// Extensiones solicitud
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'PedidoParaDias') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD PedidoParaDias INT NULL`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'FrecuenciaMuestreoMeses') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD FrecuenciaMuestreoMeses INT NULL`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'RetrasoEstimadoDias') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD RetrasoEstimadoDias INT NULL`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'IncluirSinMovimientos') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD IncluirSinMovimientos BIT NOT NULL CONSTRAINT DF_Sol_SinMov DEFAULT (0)`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'IncluirStockSuficiente') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD IncluirStockSuficiente BIT NOT NULL CONSTRAINT DF_Sol_StockSuf DEFAULT (0)`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'Rubro') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD Rubro NVARCHAR(100) NULL`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'FechaUltimaMod') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD FechaUltimaMod DATETIME2 NULL`,
	// Id del sector hospital (imSectores.Valor) que origina la solicitud
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'IdSector') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD IdSector NVARCHAR(50) NULL`,
	// Config: sectores del hospital habilitados como origen de pedidos a Almacén
	`IF OBJECT_ID('dbo.imAlmacenConfigSector', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenConfigSector (
    IdConfig INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdSector NVARCHAR(50) NOT NULL,
    IdDeposito INT NULL,
    PuedeSolicitar BIT NOT NULL CONSTRAINT DF_imAlmCfgSec_Sol DEFAULT (1),
    Activo BIT NOT NULL CONSTRAINT DF_imAlmCfgSec_Act DEFAULT (1),
    Orden INT NOT NULL CONSTRAINT DF_imAlmCfgSec_Ord DEFAULT (0),
    Observaciones NVARCHAR(200) NULL,
    CONSTRAINT UQ_imAlmacenConfigSector_IdSector UNIQUE (IdSector)
  )`,
	// Rubros (catálogo editable)
	`IF OBJECT_ID('dbo.imAlmacenRubro', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenRubro (
    IdRubro INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo NVARCHAR(50) NOT NULL,
    Nombre NVARCHAR(100) NOT NULL,
    Activo BIT NOT NULL CONSTRAINT DF_imAlmRubro_Act DEFAULT (1),
    Orden INT NOT NULL CONSTRAINT DF_imAlmRubro_Ord DEFAULT (0),
    CONSTRAINT UQ_imAlmacenRubro_Codigo UNIQUE (Codigo)
  )`,
	// Fondos presupuestarios (catálogo editable — legacy, no usado en UI)
	`IF OBJECT_ID('dbo.imAlmacenFondo', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenFondo (
    IdFondo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo NVARCHAR(50) NOT NULL,
    Nombre NVARCHAR(100) NOT NULL,
    Activo BIT NOT NULL CONSTRAINT DF_imAlmFondo_Act DEFAULT (1),
    Orden INT NOT NULL CONSTRAINT DF_imAlmFondo_Ord DEFAULT (0),
    CONSTRAINT UQ_imAlmacenFondo_Codigo UNIQUE (Codigo)
  )`,
	// Tipo de artículo (medicamento, descartable, etc.) — agrupa barras por depósito
	`IF COL_LENGTH('dbo.imAlmacenArticulo', 'TipoCodigo') IS NULL
  ALTER TABLE dbo.imAlmacenArticulo ADD TipoCodigo NVARCHAR(20) NULL`,
	`IF COL_LENGTH('dbo.imAlmacenArticulo', 'TipoNombre') IS NULL
  ALTER TABLE dbo.imAlmacenArticulo ADD TipoNombre NVARCHAR(80) NULL`,
	`IF COL_LENGTH('dbo.imAlmacenArticulo', 'Origen') IS NULL
  ALTER TABLE dbo.imAlmacenArticulo ADD Origen NVARCHAR(20) NULL`,
	// Meta key/value (sync vademécum, flags)
	`IF OBJECT_ID('dbo.imAlmacenMeta', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenMeta (
    Clave NVARCHAR(80) NOT NULL PRIMARY KEY,
    Valor NVARCHAR(400) NULL,
    FechaActualizacion DATETIME2 NOT NULL CONSTRAINT DF_imAlmMeta_Fec DEFAULT (SYSUTCDATETIME())
  )`,
	// Observaciones en proveedores
	`IF COL_LENGTH('dbo.imAlmacenProveedor', 'Observaciones') IS NULL
  ALTER TABLE dbo.imAlmacenProveedor ADD Observaciones NVARCHAR(500) NULL`,
	// Tipo de solicitud: COMPRA (provisión) o TRANSFERENCIA (entre depósitos)
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'TipoSolicitud') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD TipoSolicitud NVARCHAR(20) NOT NULL CONSTRAINT DF_imAlmSol_Tipo DEFAULT (N'COMPRA')`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'IdDepositoOrigen') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD IdDepositoOrigen INT NULL`,
	`IF COL_LENGTH('dbo.imAlmacenSolicitud', 'IdDepositoDestino') IS NULL
  ALTER TABLE dbo.imAlmacenSolicitud ADD IdDepositoDestino INT NULL`,
];

const ensureAlmacenSchema = createTenantOnce(async () => {
	for (const sql of DDL) {
		await executeQuery(sql);
	}
});

/** Reset cache (tests). */
function resetSchemaCache() {
	ensureAlmacenSchema.resetAll();
}

module.exports = { ensureAlmacenSchema, resetSchemaCache };
