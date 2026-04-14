/*
  MIGRACIÓN PRODUCCIÓN — INTEGRAL (Laboratorios + OCR). Idempotente.
  Cambiar USE por tu base. BACKUP antes de ejecutar.

  Nota SSMS: los UPDATE/CREATE INDEX que usan columnas nuevas van en SQL dinámico;
  si no, el motor compila el lote entero y falla con "nombre de columna no válido"
  aunque el IF sea falso.
*/
USE [TU_BASE_DATOS_AQUI];
GO

SET NOCOUNT ON;
PRINT N'=== Parte A: cabecera laboratorio (vínculo visita) ===';
GO

/* ---------- A1. Columna NumeroVisita ---------- */
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.imHCExamenesLabCabecera', N'U') IS NULL
    PRINT N'⚠ No existe dbo.imHCExamenesLabCabecera — se omite Parte A.';
ELSE IF COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'NumeroVisita') IS NULL
BEGIN
    ALTER TABLE dbo.imHCExamenesLabCabecera ADD NumeroVisita INT NULL;
    PRINT N'✓ Agregada columna NumeroVisita en imHCExamenesLabCabecera.';
END
ELSE
    PRINT N'→ NumeroVisita ya existe en imHCExamenesLabCabecera.';
GO

/* ---------- A2. Rellenar NumeroVisita desde IdPaciente (solo NULL) ---------- */
SET NOCOUNT ON;
IF COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'NumeroVisita') IS NOT NULL
   AND COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'IdPaciente') IS NOT NULL
BEGIN
    DECLARE @a2 NVARCHAR(600) = N'
UPDATE c
SET c.NumeroVisita = c.IdPaciente
FROM dbo.imHCExamenesLabCabecera AS c
WHERE c.NumeroVisita IS NULL AND c.IdPaciente IS NOT NULL;';
    EXEC sp_executesql @a2;
    PRINT N'✓ NumeroVisita sincronizado desde IdPaciente donde faltaba.';
END
GO

/* ---------- A3. Columna IdPaciente (instalaciones que solo tenían NumeroVisita) ---------- */
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.imHCExamenesLabCabecera', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'IdPaciente') IS NULL
BEGIN
    ALTER TABLE dbo.imHCExamenesLabCabecera ADD IdPaciente INT NULL;
    PRINT N'✓ Agregada columna IdPaciente en imHCExamenesLabCabecera.';
END
ELSE IF OBJECT_ID(N'dbo.imHCExamenesLabCabecera', N'U') IS NOT NULL
    PRINT N'→ IdPaciente ya existe en imHCExamenesLabCabecera.';
GO

/* ---------- A4. Rellenar IdPaciente desde NumeroVisita (solo NULL) ---------- */
SET NOCOUNT ON;
IF COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'NumeroVisita') IS NOT NULL
   AND COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'IdPaciente') IS NOT NULL
BEGIN
    DECLARE @a4 NVARCHAR(600) = N'
UPDATE c
SET c.IdPaciente = c.NumeroVisita
FROM dbo.imHCExamenesLabCabecera AS c
WHERE c.IdPaciente IS NULL AND c.NumeroVisita IS NOT NULL;';
    EXEC sp_executesql @a4;
    PRINT N'✓ IdPaciente sincronizado desde NumeroVisita donde faltaba.';
END
GO

/* ---------- A5. Índice para búsquedas por visita (dinámico: evita error 207) ---------- */
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.imHCExamenesLabCabecera', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.imHCExamenesLabCabecera', N'NumeroVisita') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.imHCExamenesLabCabecera', N'U')
          AND name = N'IX_imHCExamenesLabCabecera_NumeroVisita'
   )
BEGIN
    BEGIN TRY
        EXEC(N'CREATE NONCLUSTERED INDEX IX_imHCExamenesLabCabecera_NumeroVisita ON dbo.imHCExamenesLabCabecera (NumeroVisita);');
        PRINT N'✓ Índice IX_imHCExamenesLabCabecera_NumeroVisita creado.';
    END TRY
    BEGIN CATCH
        PRINT N'⚠ No se pudo crear índice IX_imHCExamenesLabCabecera_NumeroVisita:';
        PRINT ERROR_MESSAGE();
    END CATCH
END
GO

SET NOCOUNT ON;
PRINT N'=== Parte B: catálogo y pipeline OCR ===';
GO

/* -------------------------------------------------------------------------- */
/* B1. Solo ALTER en este lote (sin UPDATE que use las columnas nuevas)       */
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
    PRINT N'✓ Tabla imParametroAlias creada.';
END
ELSE
    PRINT N'→ imParametroAlias ya existe.';
GO

/* Índices por separado (idempotente; evita "el índice ya existe" en re-ejecuciones) */
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.imParametroAlias', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.imParametroAlias', N'U')
          AND name = N'IDX_Alias_Normalizado'
    )
    BEGIN
        BEGIN TRY
            EXEC(N'CREATE NONCLUSTERED INDEX IDX_Alias_Normalizado ON dbo.imParametroAlias (AliasNormalizado);');
            PRINT N'✓ Índice IDX_Alias_Normalizado creado.';
        END TRY
        BEGIN CATCH
            PRINT N'⚠ IDX_Alias_Normalizado:';
            PRINT ERROR_MESSAGE();
        END CATCH
    END
    ELSE
        PRINT N'→ IDX_Alias_Normalizado ya existe.';

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.imParametroAlias', N'U')
          AND name = N'IDX_Alias_TipoEstudio'
    )
    BEGIN
        BEGIN TRY
            EXEC(N'CREATE NONCLUSTERED INDEX IDX_Alias_TipoEstudio ON dbo.imParametroAlias (IdTipoLaboratorio, Estudio);');
            PRINT N'✓ Índice IDX_Alias_TipoEstudio creado.';
        END TRY
        BEGIN CATCH
            PRINT N'⚠ IDX_Alias_TipoEstudio:';
            PRINT ERROR_MESSAGE();
        END CATCH
    END
    ELSE
        PRINT N'→ IDX_Alias_TipoEstudio ya existe.';
END
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
    EXEC(N'CREATE NONCLUSTERED INDEX IDX_OCRLog_Examen ON dbo.imOCRLog (IdExamenLaboratorio);');
    EXEC(N'CREATE NONCLUSTERED INDEX IDX_OCRLog_Fecha ON dbo.imOCRLog (FechaProceso);');
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
        EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX UQ_Detalle_Examen_Parametro ON dbo.imHCExamenesLabDetalle (IdExamenLaboratorio, IdTipoLaboratorio, Estudio);');
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

PRINT N'=== Fin migración integral (laboratorios + OCR) ===';
GO
