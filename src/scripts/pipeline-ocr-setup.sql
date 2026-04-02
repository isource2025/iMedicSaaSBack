-- =====================================================
-- PIPELINE PROFESIONAL OCR - SETUP DE BASE DE DATOS
-- =====================================================
-- Este script configura la BD para el sistema de matching inteligente

USE iSource;
GO

PRINT '=== INICIANDO SETUP DE PIPELINE OCR ===';
GO

-- =====================================================
-- 1. Agregar columna nombre_normalizado a catálogo
-- =====================================================
PRINT '1. Agregando columna nombre_normalizado...';

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf' 
    AND COLUMN_NAME = 'NombreNormalizado'
)
BEGIN
    ALTER TABLE imHCExamenesLabDetalleConf
    ADD NombreNormalizado VARCHAR(255) NULL;
    PRINT '   ✓ Columna NombreNormalizado agregada';
END
ELSE
BEGIN
    PRINT '   → Columna NombreNormalizado ya existe';
END
GO

-- =====================================================
-- 2. Crear tabla de Alias/Sinónimos
-- =====================================================
PRINT '2. Creando tabla de alias...';

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='imParametroAlias' AND xtype='U')
BEGIN
    CREATE TABLE imParametroAlias (
        IdAlias INT IDENTITY(1,1) PRIMARY KEY,
        IdTipoLaboratorio VARCHAR(200) NOT NULL,
        Estudio VARCHAR(90) NOT NULL, -- Nombre canónico del parámetro
        Alias VARCHAR(255) NOT NULL, -- Sinónimo/alias
        AliasNormalizado VARCHAR(255) NOT NULL, -- Alias normalizado para matching
        Activo BIT DEFAULT 1,
        FechaCreacion DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Alias_Parametro FOREIGN KEY (IdTipoLaboratorio, Estudio) 
            REFERENCES imHCExamenesLabDetalleConf(IdTipoLaboratorio, Estudio)
    );
    
    CREATE INDEX IDX_Alias_Normalizado ON imParametroAlias(AliasNormalizado);
    CREATE INDEX IDX_Alias_TipoEstudio ON imParametroAlias(IdTipoLaboratorio, Estudio);
    
    PRINT '   ✓ Tabla imParametroAlias creada';
END
ELSE
BEGIN
    PRINT '   → Tabla imParametroAlias ya existe';
END
GO

-- =====================================================
-- 3. Crear tabla de Log OCR (auditoría)
-- =====================================================
PRINT '3. Creando tabla de log OCR...';

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='imOCRLog' AND xtype='U')
BEGIN
    CREATE TABLE imOCRLog (
        IdLog INT IDENTITY(1,1) PRIMARY KEY,
        IdExamenLaboratorio INT NULL,
        TextoOriginal VARCHAR(500) NOT NULL,
        TextoNormalizado VARCHAR(500) NOT NULL,
        ParametroMatch VARCHAR(90) NULL,
        Score DECIMAL(5,4) NULL,
        TipoMatch VARCHAR(50) NULL, -- 'EXACTO', 'ALIAS', 'FUZZY', 'NO_MATCH'
        FechaProceso DATETIME DEFAULT GETDATE(),
        NumeroVisita INT NULL,
        TipoEstudio VARCHAR(200) NULL
    );
    
    CREATE INDEX IDX_OCRLog_Examen ON imOCRLog(IdExamenLaboratorio);
    CREATE INDEX IDX_OCRLog_Fecha ON imOCRLog(FechaProceso);
    
    PRINT '   ✓ Tabla imOCRLog creada';
END
ELSE
BEGIN
    PRINT '   → Tabla imOCRLog ya existe';
END
GO

-- =====================================================
-- 4. Agregar constraint UNIQUE para evitar duplicados
-- =====================================================
PRINT '4. Agregando constraint anti-duplicación...';

-- Primero verificar si ya existe el constraint
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE name = 'UQ_Detalle_Examen_Parametro' 
    AND object_id = OBJECT_ID('imHCExamenesLabDetalle')
)
BEGIN
    -- Eliminar duplicados existentes antes de crear el constraint
    PRINT '   → Limpiando duplicados existentes...';
    
    WITH CTE AS (
        SELECT *,
            ROW_NUMBER() OVER (
                PARTITION BY IdExamenLaboratorio, IdTipoLaboratorio, Estudio 
                ORDER BY Orden
            ) AS rn
        FROM imHCExamenesLabDetalle
    )
    DELETE FROM CTE WHERE rn > 1;
    
    -- Crear constraint
    CREATE UNIQUE INDEX UQ_Detalle_Examen_Parametro 
    ON imHCExamenesLabDetalle(IdExamenLaboratorio, IdTipoLaboratorio, Estudio);
    
    PRINT '   ✓ Constraint anti-duplicación creado';
END
ELSE
BEGIN
    PRINT '   → Constraint anti-duplicación ya existe';
END
GO

-- =====================================================
-- 5. Poblar alias comunes (datos iniciales)
-- =====================================================
PRINT '5. Poblando alias comunes...';

-- Solo insertar si la tabla está vacía
IF NOT EXISTS (SELECT TOP 1 * FROM imParametroAlias)
BEGIN
    -- Primero asegurar que existan los parámetros base en el catálogo
    -- (esto se hará cuando se procese el primer PDF)
    
    PRINT '   → Tabla de alias vacía, se poblará al procesar primer examen';
END
ELSE
BEGIN
    PRINT '   → Alias ya poblados';
END
GO

-- =====================================================
-- 6. Normalizar datos existentes
-- =====================================================
PRINT '6. Normalizando datos existentes en catálogo...';

-- Actualizar NombreNormalizado para registros existentes
UPDATE imHCExamenesLabDetalleConf
SET NombreNormalizado = 
    UPPER(
        REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(Estudio, 'á', 'a'),
                        'é', 'e'
                    ),
                    'í', 'i'
                ),
                'ó', 'o'
            ),
            'ú', 'u'
        )
    )
WHERE NombreNormalizado IS NULL;

PRINT '   ✓ Datos normalizados';
GO

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================
PRINT '';
PRINT '=== VERIFICACIÓN DE SETUP ===';

SELECT 
    'imHCExamenesLabDetalleConf' as Tabla,
    COUNT(*) as Registros,
    SUM(CASE WHEN NombreNormalizado IS NOT NULL THEN 1 ELSE 0 END) as Normalizados
FROM imHCExamenesLabDetalleConf
UNION ALL
SELECT 
    'imParametroAlias' as Tabla,
    COUNT(*) as Registros,
    COUNT(*) as Normalizados
FROM imParametroAlias
UNION ALL
SELECT 
    'imOCRLog' as Tabla,
    COUNT(*) as Registros,
    COUNT(*) as Normalizados
FROM imOCRLog;

PRINT '';
PRINT '=== SETUP COMPLETADO EXITOSAMENTE ===';
GO
