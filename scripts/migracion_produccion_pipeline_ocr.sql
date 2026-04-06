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
/* 2. Nuevo lote: ya existe NombreNormalizado para el compilador              */
/* -------------------------------------------------------------------------- */

SET NOCOUNT ON;

-- Normalización simple y válida en T-SQL (REPLACE anidados correctos)
UPDATE dbo.imHCExamenesLabDetalleConf
SET NombreNormalizado = UPPER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(
        LTRIM(RTRIM(ISNULL(Estudio, N''))),
        N'á', N'A'), N'é', N'E'), N'í', N'I'), N'ó', N'O'), N'ú', N'U'),
        N'Á', N'A'), N'É', N'E'), N'Í', N'I'), N'Ó', N'O'), N'Ú', N'U'),
        N'à', N'A'), N'è', N'E'), N'ì', N'I'), N'ò', N'O'), N'ù', N'U'),
        N'ñ', N'N'), N'Ñ', N'N'), N'ü', N'U'), N'Ü', N'U')
    )
WHERE NombreNormalizado IS NULL
   OR LTRIM(RTRIM(NombreNormalizado)) = N'';

PRINT N'✓ NombreNormalizado actualizado donde faltaba.';
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

IF COL_LENGTH(N'dbo.imHCExamenesLabDetalleConf', N'NombreNormalizado') IS NOT NULL
BEGIN
    SELECT N'imHCExamenesLabDetalleConf' AS Tabla,
           COUNT(*) AS Registros,
           SUM(CASE WHEN NombreNormalizado IS NOT NULL AND LTRIM(RTRIM(NombreNormalizado)) <> N'' THEN 1 ELSE 0 END) AS ConNombreNormalizado
    FROM dbo.imHCExamenesLabDetalleConf;
END
ELSE
    PRINT N'⚠ No existe columna NombreNormalizado en imHCExamenesLabDetalleConf (revisar esquema dbo).';

IF OBJECT_ID(N'dbo.imParametroAlias', N'U') IS NOT NULL
    SELECT N'imParametroAlias' AS Tabla, COUNT(*) AS Registros FROM dbo.imParametroAlias;

IF OBJECT_ID(N'dbo.imOCRLog', N'U') IS NOT NULL
    SELECT N'imOCRLog' AS Tabla, COUNT(*) AS Registros FROM dbo.imOCRLog;

PRINT N'=== Fin migración pipeline OCR ===';
GO
