/*
  =============================================================================
  MIGRACIÓN PRODUCCIÓN — Pipeline OCR / Laboratorios (iMedicWS Back)
  =============================================================================
  IMPORTANTE: Tras cada bloque ALTER va un GO para que el siguiente UPDATE
  compile con la columna ya existente (limitación de lotes en SQL Server).

  Antes: BACKUP de la base.

  Si tus tablas NO están en esquema dbo, reemplazá "dbo." por el esquema correcto.
*/

USE [TU_BASE_DATOS_AQUI];
GO

SET NOCOUNT ON;
PRINT N'=== Inicio migración pipeline OCR ===';
GO

/* -------------------------------------------------------------------------- */
/* 1. Solo ALTER en este lote (sin UPDATE que use las columnas nuevas)        */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.name = N'imHCExamenesLabDetalleConf'
      AND c.name = N'NombreNormalizado'
      AND s.name = N'dbo'
)
BEGIN
    ALTER TABLE dbo.imHCExamenesLabDetalleConf
    ADD NombreNormalizado VARCHAR(255) NULL;
    PRINT N'✓ Columna NombreNormalizado agregada.';
END
ELSE
    PRINT N'→ NombreNormalizado ya existe.';

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.name = N'imHCExamenesLabDetalleConf'
      AND c.name = N'Orden'
      AND s.name = N'dbo'
)
BEGIN
    ALTER TABLE dbo.imHCExamenesLabDetalleConf
    ADD Orden INT NULL;
    PRINT N'✓ Columna Orden agregada.';
END
ELSE
    PRINT N'→ Orden ya existe.';

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    INNER JOIN sys.tables t ON c.object_id = t.object_id
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.name = N'imHCExamenesLabDetalleConf'
      AND c.name = N'AlertaCritica'
      AND s.name = N'dbo'
)
BEGIN
    ALTER TABLE dbo.imHCExamenesLabDetalleConf
    ADD AlertaCritica BIT NOT NULL
        CONSTRAINT DF_imHCExamenesLabDetalleConf_AlertaCritica DEFAULT 0;
    PRINT N'✓ Columna AlertaCritica agregada.';
END
ELSE
    PRINT N'→ AlertaCritica ya existe.';
GO

/* -------------------------------------------------------------------------- */
/* 2. Poblar NombreNormalizado (SQL dinámico: compila al ejecutar, no al abrir */
/*    el script; evita error 207 si alguien ejecuta solo este bloque).        */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;

IF COL_LENGTH(N'dbo.imHCExamenesLabDetalleConf', N'NombreNormalizado') IS NULL
BEGIN
    PRINT N'ERROR: no existe columna NombreNormalizado. Ejecutá el lote 1 completo (hasta su GO) antes de este.';
END
ELSE
BEGIN
    DECLARE @upd NVARCHAR(MAX) = N'
UPDATE dbo.imHCExamenesLabDetalleConf
SET NombreNormalizado = UPPER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(
        LTRIM(RTRIM(ISNULL(Estudio, N''''))),
        NCHAR(225), N''A''), NCHAR(233), N''E''), NCHAR(237), N''I''), NCHAR(243), N''O''), NCHAR(250), N''U''),
        NCHAR(193), N''A''), NCHAR(201), N''E''), NCHAR(205), N''I''), NCHAR(211), N''O''), NCHAR(218), N''U''),
        NCHAR(224), N''A''), NCHAR(232), N''E''), NCHAR(236), N''I''), NCHAR(242), N''O''), NCHAR(249), N''U''),
        NCHAR(241), N''N''), NCHAR(209), N''N''), NCHAR(252), N''U''), NCHAR(220), N''U'')
    )
WHERE NombreNormalizado IS NULL
   OR LEN(LTRIM(RTRIM(ISNULL(NombreNormalizado, N'''')))) = 0;
';
    EXEC sp_executesql @upd;
    PRINT N'✓ NombreNormalizado actualizado donde faltaba.';
END
GO

/* -------------------------------------------------------------------------- */
/* 3. imParametroAlias                                                         */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.imParametroAlias', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.imParametroAlias (
        IdAlias INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_imParametroAlias PRIMARY KEY,
        IdTipoLaboratorio VARCHAR(200) NOT NULL,
        Estudio VARCHAR(90) NOT NULL,
        Alias VARCHAR(255) NOT NULL,
        AliasNormalizado VARCHAR(255) NOT NULL,
        Activo BIT NOT NULL CONSTRAINT DF_imParametroAlias_Activo DEFAULT 1,
        FechaCreacion DATETIME NOT NULL CONSTRAINT DF_imParametroAlias_Fecha DEFAULT GETDATE()
    );
    CREATE NONCLUSTERED INDEX IDX_Alias_Normalizado
        ON dbo.imParametroAlias (AliasNormalizado);
    CREATE NONCLUSTERED INDEX IDX_Alias_TipoEstudio
        ON dbo.imParametroAlias (IdTipoLaboratorio, Estudio);
    PRINT N'✓ Tabla imParametroAlias creada.';
END
ELSE
    PRINT N'→ imParametroAlias ya existe.';
GO

/* -------------------------------------------------------------------------- */
/* 4. imOCRLog                                                                 */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.imOCRLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.imOCRLog (
        IdLog INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_imOCRLog PRIMARY KEY,
        IdExamenLaboratorio INT NULL,
        TextoOriginal VARCHAR(500) NOT NULL,
        TextoNormalizado VARCHAR(500) NOT NULL,
        ParametroMatch VARCHAR(90) NULL,
        Score DECIMAL(5,4) NULL,
        TipoMatch VARCHAR(50) NULL,
        FechaProceso DATETIME NOT NULL CONSTRAINT DF_imOCRLog_Fecha DEFAULT GETDATE(),
        NumeroVisita INT NULL,
        TipoEstudio VARCHAR(200) NULL
    );
    CREATE NONCLUSTERED INDEX IDX_OCRLog_Examen ON dbo.imOCRLog (IdExamenLaboratorio);
    CREATE NONCLUSTERED INDEX IDX_OCRLog_Fecha ON dbo.imOCRLog (FechaProceso);
    PRINT N'✓ Tabla imOCRLog creada.';
END
ELSE
    PRINT N'→ imOCRLog ya existe.';
GO

/* -------------------------------------------------------------------------- */
/* 5. OPCIONAL — índice único en detalle                                       */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_Detalle_Examen_Parametro'
      AND object_id = OBJECT_ID(N'dbo.imHCExamenesLabDetalle', N'U')
)
BEGIN
    PRINT N'→ Limpiando duplicados en imHCExamenesLabDetalle...';
    ;WITH CTE AS (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY IdExamenLaboratorio, IdTipoLaboratorio, Estudio
                ORDER BY Orden
            ) AS rn
        FROM dbo.imHCExamenesLabDetalle
    )
    DELETE FROM CTE WHERE rn > 1;

    BEGIN TRY
        CREATE UNIQUE NONCLUSTERED INDEX UQ_Detalle_Examen_Parametro
            ON dbo.imHCExamenesLabDetalle (IdExamenLaboratorio, IdTipoLaboratorio, Estudio);
        PRINT N'✓ Índice único UQ_Detalle_Examen_Parametro creado.';
    END TRY
    BEGIN CATCH
        PRINT N'⚠ No se pudo crear UQ_Detalle_Examen_Parametro:';
        PRINT ERROR_MESSAGE();
    END CATCH
END
ELSE
    PRINT N'→ UQ_Detalle_Examen_Parametro ya existe.';
GO

/* -------------------------------------------------------------------------- */
/* Verificación                                                                */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;
PRINT N'';
PRINT N'=== Verificación ===';

/* Sin SQL dinámico, el motor valida NombreNormalizado al compilar el IF aunque la rama no corra → error 207 */
IF COL_LENGTH(N'dbo.imHCExamenesLabDetalleConf', N'NombreNormalizado') IS NOT NULL
    EXEC(N'SELECT N''imHCExamenesLabDetalleConf'' AS Tabla, COUNT(*) AS Registros,
        SUM(CASE WHEN NombreNormalizado IS NOT NULL AND LTRIM(RTRIM(NombreNormalizado)) <> N'''' THEN 1 ELSE 0 END) AS ConNombreNormalizado
    FROM dbo.imHCExamenesLabDetalleConf;');
ELSE
    PRINT N'⚠ No existe columna NombreNormalizado en imHCExamenesLabDetalleConf (revisar esquema dbo).';

IF OBJECT_ID(N'dbo.imParametroAlias', N'U') IS NOT NULL
    SELECT N'imParametroAlias' AS Tabla, COUNT(*) AS Registros FROM dbo.imParametroAlias;

IF OBJECT_ID(N'dbo.imOCRLog', N'U') IS NOT NULL
    SELECT N'imOCRLog' AS Tabla, COUNT(*) AS Registros FROM dbo.imOCRLog;

PRINT N'=== Fin migración pipeline OCR ===';
GO
