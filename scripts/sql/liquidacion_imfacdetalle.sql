/*
================================================================================
  iMedic — Importe liquidado en dbo.imFacDetalle
================================================================================
  Agrega dbo.imFacDetalle.ImporteLiquidado, donde queda el importe que la obra
  social liquidó al profesional, y las dos tablas del historial de las
  importaciones del Excel de liquidación:

    dbo.imFacLiquidacionImport          cabecera (archivo, usuario, totales)
    dbo.imFacLiquidacionImportDetalle   una fila por renglón del Excel

  La columna se agrega NULL, al final de la tabla y sin default ni trigger:
  dbo.imFacDetalle la escribe también el Clarion del cliente y ese es el único
  cambio de esquema que no le altera el layout. Va como DECIMAL(19,2), que es
  como ya está creada en la BD de Vidal y el detalle con el que la obra social
  liquida (IMPORTE_FINAL usa 4 decimales porque valoriza unitarios).

  Si la columna ya existe no se toca, sea cual sea su tipo.

  Idempotente: se puede volver a correr, no toca lo que ya existe.

  Uso SSMS:
    USE [NombreDeTuBD];
    Ejecutar este archivo completo (F5)

  Uso Node (todas las empresas del catálogo, con verificación):
    node scripts/instalar_liquidacion_imfacdetalle.js --todas
================================================================================
*/

SET NOCOUNT ON;

/*------------------------------------------------------------------------------
  1) Columna imFacDetalle.ImporteLiquidado
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imFacDetalle', N'U') IS NULL
	RAISERROR('No existe dbo.imFacDetalle en esta BD: no es una base de facturación.', 16, 1);
ELSE IF COL_LENGTH('dbo.imFacDetalle', 'ImporteLiquidado') IS NOT NULL
	PRINT 'Ya existía: dbo.imFacDetalle.ImporteLiquidado';
ELSE
BEGIN
	ALTER TABLE dbo.imFacDetalle ADD ImporteLiquidado DECIMAL(19, 2) NULL;
	PRINT 'Creada: dbo.imFacDetalle.ImporteLiquidado DECIMAL(19,2) NULL';
END

/*------------------------------------------------------------------------------
  2) Cabecera de cada importación

  Es de la web (no la escribe el Clarion), así que IDENTITY acá no interfiere
  con el SELECT @@IDENTITY que usa el driver ODBC del Clarion sobre imFacDetalle.
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imFacLiquidacionImport', N'U') IS NULL
BEGIN
	CREATE TABLE dbo.imFacLiquidacionImport (
		IdImport        INT           IDENTITY(1,1) NOT NULL,
		Archivo         NVARCHAR(260) NOT NULL,
		HashArchivo     CHAR(64)      NULL,          -- sha256 del archivo, para detectar reimportaciones
		Hoja            NVARCHAR(128) NULL,
		FechaHora       DATETIME2(3)  NOT NULL CONSTRAINT DF_imFacLiqImport_Fecha DEFAULT SYSDATETIME(),
		Usuario         VARCHAR(115)  NULL,
		IdOperador      INT           NULL,          -- imPassword.CodOperador
		FilasArchivo    INT           NOT NULL CONSTRAINT DF_imFacLiqImport_Filas   DEFAULT 0,
		FilasAplicadas  INT           NOT NULL CONSTRAINT DF_imFacLiqImport_Aplicadas DEFAULT 0,
		FilasRechazadas INT           NOT NULL CONSTRAINT DF_imFacLiqImport_Rechazadas DEFAULT 0,
		ImporteAplicado DECIMAL(19,4) NOT NULL CONSTRAINT DF_imFacLiqImport_Importe   DEFAULT 0,
		Estado          VARCHAR(15)   NOT NULL CONSTRAINT DF_imFacLiqImport_Estado    DEFAULT 'APLICADO',
		CONSTRAINT PK_imFacLiquidacionImport PRIMARY KEY (IdImport),
		CONSTRAINT CK_imFacLiquidacionImport_Estado CHECK (Estado IN ('APLICADO', 'REVERTIDO'))
	);

	CREATE INDEX IX_imFacLiquidacionImport_Fecha ON dbo.imFacLiquidacionImport (FechaHora DESC);

	PRINT 'Creada: dbo.imFacLiquidacionImport';
END
ELSE
	PRINT 'Ya existía: dbo.imFacLiquidacionImport';

/*------------------------------------------------------------------------------
  3) Detalle: qué pasó con cada renglón del Excel

  ImporteAnterior guarda el valor que tenía la fila antes del UPDATE, así que
  con este detalle se puede revertir una importación equivocada.
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imFacLiquidacionImportDetalle', N'U') IS NULL
BEGIN
	CREATE TABLE dbo.imFacLiquidacionImportDetalle (
		IdImportDetalle INT           IDENTITY(1,1) NOT NULL,
		IdImport        INT           NOT NULL,
		FilaExcel       INT           NULL,          -- número de fila en la hoja, para poder señalarla
		IdPrestacion    INT           NULL,
		IdDetalleExcel  INT           NULL,          -- columna IdDetalle del Excel (informativa)
		Matricula       INT           NULL,
		NumeroVisita    INT           NULL,
		ImporteExcel    DECIMAL(19,4) NULL,
		IdDetalle       INT           NULL,          -- imFacDetalle.IDDETALLE actualizado
		TipoPrestacion  VARCHAR(5)    NULL,
		ImporteAnterior DECIMAL(19,4) NULL,
		ImporteNuevo    DECIMAL(19,4) NULL,
		Estado          VARCHAR(20)   NOT NULL,
		Detalle         NVARCHAR(300) NULL,
		CONSTRAINT PK_imFacLiquidacionImportDetalle PRIMARY KEY (IdImportDetalle),
		CONSTRAINT FK_imFacLiqImportDet_Import FOREIGN KEY (IdImport)
			REFERENCES dbo.imFacLiquidacionImport (IdImport),
		CONSTRAINT CK_imFacLiqImportDet_Estado CHECK (
			Estado IN ('APLICADO', 'SIN_CAMBIO', 'AMBIGUA', 'SIN_MATCH', 'DUPLICADA_EXCEL', 'REVERTIDO')
		)
	);

	CREATE INDEX IX_imFacLiqImportDet_Import      ON dbo.imFacLiquidacionImportDetalle (IdImport);
	CREATE INDEX IX_imFacLiqImportDet_Prestacion  ON dbo.imFacLiquidacionImportDetalle (IdPrestacion);

	PRINT 'Creada: dbo.imFacLiquidacionImportDetalle';
END
ELSE
	PRINT 'Ya existía: dbo.imFacLiquidacionImportDetalle';

/*------------------------------------------------------------------------------
  4) Control final: si algo no quedó, el instalador tiene que fallar
------------------------------------------------------------------------------*/
IF COL_LENGTH('dbo.imFacDetalle', 'ImporteLiquidado') IS NULL
	RAISERROR('No se pudo crear dbo.imFacDetalle.ImporteLiquidado.', 16, 1);
ELSE IF OBJECT_ID(N'dbo.imFacLiquidacionImport', N'U') IS NULL
	RAISERROR('No se pudo crear dbo.imFacLiquidacionImport.', 16, 1);
ELSE IF OBJECT_ID(N'dbo.imFacLiquidacionImportDetalle', N'U') IS NULL
	RAISERROR('No se pudo crear dbo.imFacLiquidacionImportDetalle.', 16, 1);
ELSE
	PRINT 'Liquidación de honorarios: esquema OK';
