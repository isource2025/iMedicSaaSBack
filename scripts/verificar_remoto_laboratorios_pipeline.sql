/*
  =============================================================================
  VERIFICACIÓN REMOTA — Laboratorios + pipeline OCR (iMedicWS Back)
  =============================================================================
  Ejecutar en SSMS contra la MISMA base que usa el API en producción.

  1) Cambiar USE por tu base.
  2) Revisar resultado: filas con OK = NO son problemas; FALTA / ERROR indican qué migrar.

  No modifica datos (solo SELECT / metadatos).
*/

USE [TU_BASE_DATOS_AQUI];
GO

SET NOCOUNT ON;

DECLARE @schema sysname = N'dbo';
DECLARE @tblConf NVARCHAR(260) = @schema + N'.imHCExamenesLabDetalleConf';

/* ---------- Helpers: columnas por tabla (esquema dbo, nombre exacto) ---------- */
IF OBJECT_ID(QUOTENAME(@schema) + N'.imHCExamenesLabCabecera', N'U') IS NULL
    SELECT N'ERROR' AS Severidad, N'imHCExamenesLabCabecera' AS Objeto, N'Tabla no existe' AS Detalle;
ELSE
    SELECT N'OK' AS Severidad, N'imHCExamenesLabCabecera' AS Objeto, N'Tabla existe' AS Detalle;

IF OBJECT_ID(QUOTENAME(@schema) + N'.imHCExamenesLabDetalle', N'U') IS NULL
    SELECT N'ERROR' AS Severidad, N'imHCExamenesLabDetalle' AS Objeto, N'Tabla no existe' AS Detalle;
ELSE
    SELECT N'OK' AS Severidad, N'imHCExamenesLabDetalle' AS Objeto, N'Tabla existe' AS Detalle;

IF OBJECT_ID(QUOTENAME(@schema) + N'.imHCExamenesLabDetalleConf', N'U') IS NULL
    SELECT N'ERROR' AS Severidad, N'imHCExamenesLabDetalleConf' AS Objeto, N'Tabla no existe' AS Detalle;
ELSE
    SELECT N'OK' AS Severidad, N'imHCExamenesLabDetalleConf' AS Objeto, N'Tabla existe' AS Detalle;

PRINT N'';
PRINT N'=== Columnas requeridas por el backend (cabecera) ===';

SELECT
    c.name AS Columna,
    CASE WHEN c.name IN (
        N'IdExamenLaboratorio', N'NroProtocolo', N'FechaEstudio',
        N'IdPaciente', N'IdTipoLaboratorio'
    ) THEN N'OK' ELSE N'INFO' END AS UsoBackend
FROM sys.columns c
INNER JOIN sys.tables t ON c.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = @schema AND t.name = N'imHCExamenesLabCabecera'
ORDER BY c.column_id;

/* Esperado: al menos IdExamenLaboratorio, NroProtocolo, FechaEstudio, IdTipoLaboratorio y (NumeroVisita O IdPaciente) */
SELECT
    CASE
        WHEN SUM(CASE WHEN c.name = N'IdExamenLaboratorio' THEN 1 ELSE 0 END) = 0 THEN N'FALTA IdExamenLaboratorio'
        WHEN SUM(CASE WHEN c.name = N'NroProtocolo' THEN 1 ELSE 0 END) = 0 THEN N'FALTA NroProtocolo'
        WHEN SUM(CASE WHEN c.name = N'FechaEstudio' THEN 1 ELSE 0 END) = 0 THEN N'FALTA FechaEstudio'
        WHEN SUM(CASE WHEN c.name = N'IdTipoLaboratorio' THEN 1 ELSE 0 END) = 0 THEN N'FALTA IdTipoLaboratorio'
        WHEN SUM(CASE WHEN c.name IN (N'IdPaciente', N'NumeroVisita') THEN 1 ELSE 0 END) = 0
            THEN N'FALTA vínculo visita: IdPaciente o NumeroVisita'
        ELSE N'OK columnas mínimas cabecera'
    END AS CheckCabeceraMinima
FROM sys.columns c
INNER JOIN sys.tables t ON c.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = @schema AND t.name = N'imHCExamenesLabCabecera';

PRINT N'';
PRINT N'=== Columnas requeridas — imHCExamenesLabDetalle ===';

SELECT
    CASE
        WHEN SUM(CASE WHEN c.name = N'IdExamenLaboratorio' THEN 1 ELSE 0 END) = 0 THEN N'FALTA IdExamenLaboratorio'
        WHEN SUM(CASE WHEN c.name = N'Orden' THEN 1 ELSE 0 END) = 0 THEN N'FALTA Orden'
        WHEN SUM(CASE WHEN c.name = N'IdTipoLaboratorio' THEN 1 ELSE 0 END) = 0 THEN N'FALTA IdTipoLaboratorio'
        WHEN SUM(CASE WHEN c.name = N'Estudio' THEN 1 ELSE 0 END) = 0 THEN N'FALTA Estudio'
        WHEN SUM(CASE WHEN c.name = N'Valor' THEN 1 ELSE 0 END) = 0 THEN N'FALTA Valor'
        ELSE N'OK columnas mínimas detalle'
    END AS CheckDetalleMinima
FROM sys.columns c
INNER JOIN sys.tables t ON c.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = @schema AND t.name = N'imHCExamenesLabDetalle';

PRINT N'';
PRINT N'=== Catálogo + pipeline OCR — imHCExamenesLabDetalleConf ===';

/* COL_LENGTH: usar dbo.Tabla sin corchetes ([dbo].Tabla puede dar NULL en algunos motores) */
SELECT
    CASE WHEN COL_LENGTH(@tblConf, N'NombreNormalizado') IS NULL
        THEN N'FALTA NombreNormalizado (ejecutar migracion_produccion_pipeline_ocr.sql)'
        ELSE N'OK NombreNormalizado' END AS CheckNombreNormalizado,
    CASE WHEN COL_LENGTH(@tblConf, N'Orden') IS NULL
        THEN N'FALTA Orden' ELSE N'OK Orden' END AS CheckOrden,
    CASE WHEN COL_LENGTH(@tblConf, N'AlertaCritica') IS NULL
        THEN N'FALTA AlertaCritica' ELSE N'OK AlertaCritica' END AS CheckAlertaCritica,
    CASE WHEN COL_LENGTH(@tblConf, N'IdTipoLaboratorio') IS NULL
        THEN N'FALTA IdTipoLaboratorio' ELSE N'OK IdTipoLaboratorio' END AS CheckIdTipo,
    CASE WHEN COL_LENGTH(@tblConf, N'Estudio') IS NULL
        THEN N'FALTA Estudio' ELSE N'OK Estudio' END AS CheckEstudio,
    CASE WHEN COL_LENGTH(@tblConf, N'ValorMinimo') IS NULL
        THEN N'FALTA ValorMinimo' ELSE N'OK ValorMinimo' END AS CheckMin,
    CASE WHEN COL_LENGTH(@tblConf, N'ValorMaximo') IS NULL
        THEN N'FALTA ValorMaximo' ELSE N'OK ValorMaximo' END AS CheckMax,
    CASE WHEN COL_LENGTH(@tblConf, N'ValorNormal') IS NULL
        THEN N'FALTA ValorNormal' ELSE N'OK ValorNormal' END AS CheckNormal;

/* Referencia a NombreNormalizado: solo en SQL dinámico; si no existe la columna, el lote entero fallaba antes */
IF OBJECT_ID(QUOTENAME(@schema) + N'.imHCExamenesLabDetalleConf', N'U') IS NOT NULL
   AND COL_LENGTH(@tblConf, N'NombreNormalizado') IS NOT NULL
    EXEC(N'SELECT COUNT(*) AS FilasCatálogo,
        SUM(CASE WHEN NombreNormalizado IS NULL OR LEN(LTRIM(RTRIM(ISNULL(NombreNormalizado, N'''')))) = 0 THEN 1 ELSE 0 END) AS SinNombreNormalizado
    FROM dbo.imHCExamenesLabDetalleConf;');
ELSE IF OBJECT_ID(QUOTENAME(@schema) + N'.imHCExamenesLabDetalleConf', N'U') IS NOT NULL
    SELECT COUNT(*) AS FilasCatálogo, CAST(NULL AS INT) AS SinNombreNormalizado_N_A_columna
    FROM dbo.imHCExamenesLabDetalleConf;

PRINT N'';
PRINT N'=== Tablas opcionales pero usadas por el matcher ===';

IF OBJECT_ID(QUOTENAME(@schema) + N'.imParametroAlias', N'U') IS NULL
    SELECT N'ADVERTENCIA' AS Severidad, N'imParametroAlias' AS Objeto,
           N'Tabla ausente: matching por alias no funcionará (API sigue con exacto/fuzzy)' AS Detalle;
ELSE
    SELECT N'OK' AS Severidad, N'imParametroAlias' AS Objeto,
           CAST((SELECT COUNT(*) FROM dbo.imParametroAlias) AS varchar(20)) + N' filas' AS Detalle;

IF OBJECT_ID(QUOTENAME(@schema) + N'.imOCRLog', N'U') IS NULL
    SELECT N'ERROR' AS Severidad, N'imOCRLog' AS Objeto,
           N'Tabla ausente: INSERT de auditoría OCR fallará al guardar examen' AS Detalle;
ELSE
BEGIN
    SELECT N'OK' AS Severidad, N'imOCRLog' AS Objeto, N'Tabla existe' AS Detalle;
    SELECT TOP 1
        CASE WHEN COL_LENGTH(QUOTENAME(@schema) + N'.imOCRLog', N'IdExamenLaboratorio') IS NULL THEN N'FALTA columna' ELSE N'OK' END AS IdExamenLaboratorio,
        CASE WHEN COL_LENGTH(QUOTENAME(@schema) + N'.imOCRLog', N'TextoOriginal') IS NULL THEN N'FALTA' ELSE N'OK' END AS TextoOriginal,
        CASE WHEN COL_LENGTH(QUOTENAME(@schema) + N'.imOCRLog', N'TipoMatch') IS NULL THEN N'FALTA' ELSE N'OK' END AS TipoMatch,
        CASE WHEN COL_LENGTH(QUOTENAME(@schema) + N'.imOCRLog', N'NumeroVisita') IS NULL THEN N'FALTA' ELSE N'OK' END AS NumeroVisita;
END

PRINT N'';
PRINT N'=== Prueba de lectura (listado por visita, según columna disponible) ===';

BEGIN TRY
    IF OBJECT_ID(QUOTENAME(@schema) + N'.imHCExamenesLabCabecera', N'U') IS NULL
        PRINT N'Saltar: no hay tabla cabecera.';
    ELSE IF COL_LENGTH(QUOTENAME(@schema) + N'.imHCExamenesLabCabecera', N'IdPaciente') IS NOT NULL
    BEGIN
        DECLARE @v1 INT = (SELECT TOP 1 IdPaciente FROM dbo.imHCExamenesLabCabecera ORDER BY FechaEstudio DESC);
        IF @v1 IS NULL PRINT N'Sin filas en cabecera.';
        ELSE
        BEGIN
            SELECT COUNT(*) AS ExamenesMismaVisita_IdPaciente FROM dbo.imHCExamenesLabCabecera WHERE IdPaciente = @v1;
            PRINT N'Prueba IdPaciente = ' + CAST(@v1 AS varchar(20));
        END
    END
    ELSE IF COL_LENGTH(QUOTENAME(@schema) + N'.imHCExamenesLabCabecera', N'NumeroVisita') IS NOT NULL
    BEGIN
        DECLARE @v2 INT = (SELECT TOP 1 NumeroVisita FROM dbo.imHCExamenesLabCabecera ORDER BY FechaEstudio DESC);
        IF @v2 IS NULL PRINT N'Sin filas en cabecera.';
        ELSE
        BEGIN
            SELECT COUNT(*) AS ExamenesMismaVisita_NumeroVisita FROM dbo.imHCExamenesLabCabecera WHERE NumeroVisita = @v2;
            PRINT N'Prueba NumeroVisita = ' + CAST(@v2 AS varchar(20));
        END
    END
    ELSE
        PRINT N'No hay IdPaciente ni NumeroVisita en cabecera: el API no podrá filtrar por visita.';
END TRY
BEGIN CATCH
    SELECT N'ERROR en prueba listado' AS Msg, ERROR_MESSAGE() AS Detalle;
END CATCH

PRINT N'';
PRINT N'=== Fin verificación ===';
GO
