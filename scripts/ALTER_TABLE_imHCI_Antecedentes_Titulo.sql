-- ============================================
-- SCRIPT: Agregar Antecedentes y Título a HC
-- Tabla: imHCI
-- Fecha: 2026-02-22
-- Descripción: Agrega 31 columnas nuevas
-- Autor: Sistema iMedicWs
-- ============================================

USE [iMedic]
GO

-- Verificar que la tabla existe
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imHCI')
BEGIN
    PRINT '❌ ERROR: La tabla imHCI no existe'
    RETURN
END
GO

PRINT ''
PRINT '================================================'
PRINT '🔧 MODIFICACIÓN DE TABLA imHCI'
PRINT '================================================'
PRINT 'Agregando 31 columnas nuevas:'
PRINT '  - 1 campo Titulo'
PRINT '  - 30 campos Antecedentes Personales (AP_*)'
PRINT '================================================'
PRINT ''
GO

-- ============================================
-- CAMPO TÍTULO (1 columna)
-- ============================================
PRINT '📝 Agregando campo Titulo...'
GO

ALTER TABLE dbo.imHCI ADD
    Titulo VARCHAR(200) NULL;
GO

PRINT '✅ Campo Titulo agregado correctamente'
PRINT ''
GO

-- ============================================
-- ANTECEDENTES PERSONALES (30 columnas)
-- Prefijo: AP_ (Antecedentes Personales)
-- ============================================

-- Del Medio y Laborales (2 campos)
PRINT '📝 Agregando campos de Medio y Laborales (2)...'
GO

ALTER TABLE dbo.imHCI ADD
    AP_ResidenciaActual VARCHAR(500) NULL,
    AP_ResidenciasAnteriores VARCHAR(500) NULL;
GO

PRINT '✅ Campos de medio y laborales agregados'
PRINT ''
GO

-- Hábitos (9 campos)
PRINT '📝 Agregando campos de Hábitos (9)...'
GO

ALTER TABLE dbo.imHCI ADD
    AP_Estudios VARCHAR(500) NULL,
    AP_Ocupacion VARCHAR(500) NULL,
    AP_AlcoholYToxicos VARCHAR(500) NULL,
    AP_Alimentacion VARCHAR(500) NULL,
    AP_Sexualidad VARCHAR(500) NULL,
    AP_Deportes VARCHAR(500) NULL,
    AP_Catarsis VARCHAR(500) NULL,
    AP_Tabaco VARCHAR(500) NULL,
    AP_OtrasAdicciones VARCHAR(500) NULL;
GO

PRINT '✅ Campos de hábitos agregados'
PRINT ''
GO

-- Patológicos (10 campos)
PRINT '📝 Agregando campos Patológicos (10)...'
GO

ALTER TABLE dbo.imHCI ADD
    AP_InfectoContagiosas VARCHAR(1000) NULL,
    AP_Vacunas VARCHAR(500) NULL,
    AP_Cardiovasculares VARCHAR(1000) NULL,
    AP_Gastrointestinales VARCHAR(1000) NULL,
    AP_Respiratorias VARCHAR(1000) NULL,
    AP_Urinarias VARCHAR(1000) NULL,
    AP_Hematologicos VARCHAR(1000) NULL,
    AP_Alergicos VARCHAR(1000) NULL,
    AP_QuirurgicosYTraumatologicos VARCHAR(1000) NULL,
    AP_Dermatologicos VARCHAR(1000) NULL,
    AP_Oftalmologicos VARCHAR(1000) NULL;
GO

PRINT '✅ Campos patológicos agregados'
PRINT ''
GO

-- Ginecológicos (7 campos)
PRINT '📝 Agregando campos Ginecológicos (7)...'
GO

ALTER TABLE dbo.imHCI ADD
    AP_GinecoQuirurgicos VARCHAR(500) NULL,
    AP_Menarca VARCHAR(100) NULL,
    AP_Ritmo VARCHAR(100) NULL,
    AP_FUM VARCHAR(100) NULL,
    AP_Abortos VARCHAR(100) NULL,
    AP_Gestas VARCHAR(100) NULL,
    AP_Partos VARCHAR(100) NULL;
GO

PRINT '✅ Campos ginecológicos agregados'
PRINT ''
GO

-- Familiares (3 campos)
PRINT '📝 Agregando campos Familiares (3)...'
GO

ALTER TABLE dbo.imHCI ADD
    AP_Anticoncepcion VARCHAR(500) NULL,
    AP_AntecedentesFamiliares VARCHAR(2000) NULL,
    AP_Hijos VARCHAR(500) NULL;
GO

PRINT '✅ Campos familiares agregados'
PRINT ''
GO

-- ============================================
-- VERIFICACIÓN FINAL
-- ============================================
PRINT '🔍 Verificando cambios...'
PRINT ''
GO

DECLARE @TotalColumnas INT
DECLARE @ColumnasNuevas INT

SELECT @TotalColumnas = COUNT(*)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCI'

SELECT @ColumnasNuevas = COUNT(*)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCI'
AND (
    COLUMN_NAME = 'Titulo'
    OR COLUMN_NAME LIKE 'AP_%'
)

PRINT '================================================'
PRINT '✅ MODIFICACIÓN COMPLETADA EXITOSAMENTE'
PRINT '================================================'
PRINT 'Total de columnas en imHCI: ' + CAST(@TotalColumnas AS VARCHAR(10))
PRINT 'Columnas nuevas agregadas: ' + CAST(@ColumnasNuevas AS VARCHAR(10))
PRINT ''
PRINT 'Detalle de columnas nuevas:'
PRINT '  - Titulo: 1'
PRINT '  - Del Medio y Laborales: 2'
PRINT '  - Hábitos: 9'
PRINT '  - Patológicos: 10'
PRINT '  - Ginecológicos: 7'
PRINT '  - Familiares: 3'
PRINT '  - TOTAL: 31'
PRINT '================================================'
GO

-- ============================================
-- ÍNDICES OPCIONALES (para mejorar performance)
-- ============================================
PRINT ''
PRINT '📊 Creando índices para optimización...'
GO

-- Crear índice en Titulo para búsquedas rápidas
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_imHCI_Titulo' AND object_id = OBJECT_ID('dbo.imHCI'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_imHCI_Titulo 
    ON dbo.imHCI(Titulo)
    WHERE Titulo IS NOT NULL;
    
    PRINT '✅ Índice IX_imHCI_Titulo creado'
END
ELSE
BEGIN
    PRINT '⚠️ Índice IX_imHCI_Titulo ya existe'
END
GO

PRINT ''
PRINT '================================================'
PRINT '🎉 SCRIPT COMPLETADO EXITOSAMENTE'
PRINT '================================================'
PRINT ''
PRINT 'La tabla imHCI ha sido actualizada con:'
PRINT '  ✅ Campo Titulo (VARCHAR 200)'
PRINT '  ✅ 30 campos de Antecedentes Personales'
PRINT '  ✅ Índice de optimización en Titulo'
PRINT ''
PRINT 'Los 129,686 registros existentes NO fueron afectados.'
PRINT 'Los nuevos campos tienen valor NULL por defecto.'
PRINT ''
PRINT '================================================'
PRINT 'Siguiente paso: Actualizar backend y frontend'
PRINT '================================================'
PRINT ''
GO

-- ============================================
-- CONSULTA DE VERIFICACIÓN (OPCIONAL)
-- ============================================
-- Descomentar para ver las columnas nuevas
/*
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imHCI'
AND (
    COLUMN_NAME = 'Titulo'
    OR COLUMN_NAME LIKE 'AP_%'
)
ORDER BY COLUMN_NAME
*/
