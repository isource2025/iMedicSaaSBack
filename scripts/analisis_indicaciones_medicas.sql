-- ============================================================================
-- SCRIPT DE ANÁLISIS: Sistema de Estados de Indicaciones Médicas
-- ============================================================================
-- Objetivo: Analizar la estructura de imInterIndicacionesMedicas y tablas
--           relacionadas para implementar el sistema de estados basado en
--           tiempo de última aplicación y frecuencia
-- ============================================================================

-- ============================================================================
-- 1. ANÁLISIS DE ESTRUCTURA DE TABLA PRINCIPAL
-- ============================================================================

PRINT '============================================================================'
PRINT '1. ESTRUCTURA DE imInterIndicacionesMedicas'
PRINT '============================================================================'

-- Obtener información de columnas
SELECT 
    COLUMN_NAME AS 'Columna',
    DATA_TYPE AS 'Tipo',
    CHARACTER_MAXIMUM_LENGTH AS 'Longitud',
    IS_NULLABLE AS 'Permite NULL',
    COLUMN_DEFAULT AS 'Valor Default'
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imInterIndMedicas'
ORDER BY ORDINAL_POSITION;

PRINT ''
PRINT '-- Campos críticos identificados para el sistema de estados:'
PRINT '-- FechaCumplido/HoraCumplido: Última vez que se aplicó la indicación (PUNTO DE ANCLAJE)'
PRINT '-- FechaProximo/HoraProximo: Próxima aplicación calculada'
PRINT '-- FechaRevision/HoraRevision: Anterior aplicación'
PRINT '-- Frecuencia: Código de frecuencia para calcular próxima aplicación'
PRINT '-- Estado: Estado actual de la indicación (char(1))'
PRINT ''

-- ============================================================================
-- 2. ANÁLISIS DE TABLA DE FRECUENCIAS
-- ============================================================================

PRINT '============================================================================'
PRINT '2. ESTRUCTURA DE imFrecuenciasAdmin (Tabla de Frecuencias)'
PRINT '============================================================================'

SELECT 
    COLUMN_NAME AS 'Columna',
    DATA_TYPE AS 'Tipo',
    CHARACTER_MAXIMUM_LENGTH AS 'Longitud',
    IS_NULLABLE AS 'Permite NULL'
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'imFrecuenciasAdmin'
ORDER BY ORDINAL_POSITION;

PRINT ''
PRINT '-- Datos de frecuencias disponibles:'
SELECT 
    Valor,
    Intervalo,
    CASE 
        WHEN Intervalo IS NOT NULL THEN 
            CAST(Intervalo / 60 AS VARCHAR) + ' horas (' + CAST(Intervalo AS VARCHAR) + ' minutos)'
        ELSE 'Sin intervalo definido'
    END AS 'Descripción Intervalo'
FROM imFrecuenciasAdmin
ORDER BY Intervalo;

PRINT ''

-- ============================================================================
-- 3. ANÁLISIS DE DATOS ACTUALES EN imInterIndicacionesMedicas
-- ============================================================================

PRINT '============================================================================'
PRINT '3. ANÁLISIS DE DATOS ACTUALES'
PRINT '============================================================================'

-- Contar indicaciones por estado
PRINT '-- Distribución de indicaciones por estado:'
SELECT 
    ISNULL(Estado, 'NULL') AS Estado,
    COUNT(*) AS Cantidad,
    CAST(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() AS DECIMAL(5,2)) AS 'Porcentaje'
FROM imInterIndMedicas
GROUP BY Estado
ORDER BY Cantidad DESC;

PRINT ''

-- Indicaciones con FechaCumplido (ya aplicadas)
PRINT '-- Indicaciones con fecha de cumplimiento (ya aplicadas):'
SELECT 
    COUNT(*) AS 'Total Aplicadas',
    COUNT(CASE WHEN FechaProximo IS NOT NULL AND FechaProximo > 0 THEN 1 END) AS 'Con Fecha Próximo',
    COUNT(CASE WHEN FechaProximo IS NULL OR FechaProximo = 0 THEN 1 END) AS 'Sin Fecha Próximo'
FROM imInterIndMedicas
WHERE FechaCumplido IS NOT NULL AND FechaCumplido > 0;

PRINT ''

-- Indicaciones sin aplicar
PRINT '-- Indicaciones sin aplicar (sin FechaCumplido):'
SELECT 
    COUNT(*) AS 'Total Sin Aplicar'
FROM imInterIndMedicas
WHERE FechaCumplido IS NULL OR FechaCumplido = 0;

PRINT ''

-- ============================================================================
-- 4. ANÁLISIS DE RELACIÓN CON FRECUENCIAS
-- ============================================================================

PRINT '============================================================================'
PRINT '4. RELACIÓN INDICACIONES - FRECUENCIAS'
PRINT '============================================================================'

PRINT '-- Indicaciones por frecuencia:'
SELECT 
    ISNULL(iim.Frecuencia, 'NULL') AS Frecuencia,
    fa.Intervalo AS 'Intervalo (minutos)',
    COUNT(*) AS 'Cantidad Indicaciones',
    COUNT(CASE WHEN iim.FechaCumplido IS NOT NULL AND iim.FechaCumplido > 0 THEN 1 END) AS 'Aplicadas',
    COUNT(CASE WHEN iim.FechaCumplido IS NULL OR iim.FechaCumplido = 0 THEN 1 END) AS 'Sin Aplicar'
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
GROUP BY iim.Frecuencia, fa.Intervalo
ORDER BY COUNT(*) DESC;

PRINT ''

-- ============================================================================
-- 5. ANÁLISIS DE CAMPOS DE FECHA/HORA
-- ============================================================================

PRINT '============================================================================'
PRINT '5. ANÁLISIS DE CAMPOS DE FECHA/HORA'
PRINT '============================================================================'

-- Verificar consistencia de datos de fecha/hora
PRINT '-- Consistencia de fechas/horas:'
SELECT 
    'FechaCumplido con HoraCumplido' AS 'Verificación',
    COUNT(CASE WHEN FechaCumplido > 0 AND (HoraCumplido IS NULL OR HoraCumplido = 0) THEN 1 END) AS 'Inconsistentes',
    COUNT(CASE WHEN FechaCumplido > 0 AND HoraCumplido > 0 THEN 1 END) AS 'Consistentes'
FROM imInterIndMedicas
UNION ALL
SELECT 
    'FechaProximo con HoraProximo',
    COUNT(CASE WHEN FechaProximo > 0 AND (HoraProximo IS NULL OR HoraProximo = 0) THEN 1 END),
    COUNT(CASE WHEN FechaProximo > 0 AND HoraProximo > 0 THEN 1 END)
FROM imInterIndMedicas
UNION ALL
SELECT 
    'FechaRevision con HoraRevision',
    COUNT(CASE WHEN FechaRevision > 0 AND (HoraRevision IS NULL OR HoraRevision = 0) THEN 1 END),
    COUNT(CASE WHEN FechaRevision > 0 AND HoraRevision > 0 THEN 1 END)
FROM imInterIndMedicas;

PRINT ''

-- ============================================================================
-- 6. BÚSQUEDA DE TABLAS RELACIONADAS
-- ============================================================================

PRINT '============================================================================'
PRINT '6. TABLAS RELACIONADAS AL SISTEMA DE INDICACIONES'
PRINT '============================================================================'

-- Buscar todas las tablas que contengan "Indic" o "Inter" en su nombre
PRINT '-- Tablas relacionadas con Indicaciones:'
SELECT 
    TABLE_NAME AS 'Tabla',
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = t.TABLE_NAME) AS 'Num Columnas'
FROM INFORMATION_SCHEMA.TABLES t
WHERE TABLE_NAME LIKE '%Indic%' OR TABLE_NAME LIKE '%Inter%'
ORDER BY TABLE_NAME;

PRINT ''

-- ============================================================================
-- 7. ANÁLISIS DE TABLA imInterCtrlMedicamento (Control de Medicamentos)
-- ============================================================================

PRINT '============================================================================'
PRINT '7. ANÁLISIS DE imInterCtrlMedicamento'
PRINT '============================================================================'

IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imInterCtrlMedicamento')
BEGIN
    SELECT 
        COLUMN_NAME AS 'Columna',
        DATA_TYPE AS 'Tipo',
        IS_NULLABLE AS 'Permite NULL'
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imInterCtrlMedicamento'
    ORDER BY ORDINAL_POSITION;
    
    PRINT ''
    PRINT '-- Relación con indicaciones:'
    SELECT 
        COUNT(DISTINCT NroIndicacion) AS 'Indicaciones con Control',
        COUNT(*) AS 'Total Registros Control'
    FROM imInterCtrlMedicamento;
END
ELSE
BEGIN
    PRINT '-- Tabla imInterCtrlMedicamento no existe'
END

PRINT ''

-- ============================================================================
-- 8. ANÁLISIS DE TABLA imInterCtrlFrecuente (Controles Frecuentes)
-- ============================================================================

PRINT '============================================================================'
PRINT '8. ANÁLISIS DE imInterCtrlFrecuente'
PRINT '============================================================================'

IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imInterCtrlFrecuente')
BEGIN
    SELECT 
        COLUMN_NAME AS 'Columna',
        DATA_TYPE AS 'Tipo',
        IS_NULLABLE AS 'Permite NULL'
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imInterCtrlFrecuente'
    ORDER BY ORDINAL_POSITION;
    
    PRINT ''
    PRINT '-- Relación con indicaciones:'
    SELECT 
        COUNT(DISTINCT Nroindicacion) AS 'Indicaciones con Control Frecuente',
        COUNT(*) AS 'Total Registros Control'
    FROM imInterCtrlFrecuente;
END
ELSE
BEGIN
    PRINT '-- Tabla imInterCtrlFrecuente no existe'
END

PRINT ''

-- ============================================================================
-- 9. ANÁLISIS DE TABLA imInterCtrlDieta (Control de Dietas)
-- ============================================================================

PRINT '============================================================================'
PRINT '9. ANÁLISIS DE imInterCtrlDieta'
PRINT '============================================================================'

IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'imInterCtrlDieta')
BEGIN
    SELECT 
        COLUMN_NAME AS 'Columna',
        DATA_TYPE AS 'Tipo',
        IS_NULLABLE AS 'Permite NULL'
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'imInterCtrlDieta'
    ORDER BY ORDINAL_POSITION;
    
    PRINT ''
    PRINT '-- Relación con indicaciones:'
    SELECT 
        COUNT(DISTINCT NroIndicacion) AS 'Indicaciones con Control Dieta',
        COUNT(*) AS 'Total Registros Control'
    FROM imInterCtrlDieta;
END
ELSE
BEGIN
    PRINT '-- Tabla imInterCtrlDieta no existe'
END

PRINT ''

-- ============================================================================
-- 10. MUESTRA DE DATOS REALES
-- ============================================================================

PRINT '============================================================================'
PRINT '10. MUESTRA DE DATOS REALES (Últimas 10 indicaciones aplicadas)'
PRINT '============================================================================'

SELECT TOP 10
    NroIndicacion,
    NumeroVisita,
    TipoIndicacion,
    Frecuencia,
    fa.Intervalo AS 'Intervalo (min)',
    -- Fecha/Hora Cumplido (última aplicación - PUNTO DE ANCLAJE)
    CONVERT(varchar(10), DATEADD(day, NULLIF(FechaCumplido,0) - 4, '1801-01-01'), 23) AS FechaCumplido,
    CONVERT(varchar(8), DATEADD(SECOND, HoraCumplido / 100, '00:00:00'), 108) AS HoraCumplido,
    -- Fecha/Hora Próximo (calculada)
    CONVERT(varchar(10), DATEADD(day, NULLIF(FechaProximo,0) - 4, '1801-01-01'), 23) AS FechaProximo,
    CONVERT(varchar(8), DATEADD(SECOND, HoraProximo / 100, '00:00:00'), 108) AS HoraProximo,
    -- Fecha/Hora Revisión (anterior)
    CONVERT(varchar(10), DATEADD(day, NULLIF(FechaRevision,0) - 4, '1801-01-01'), 23) AS FechaRevision,
    CONVERT(varchar(8), DATEADD(SECOND, HoraRevision / 100, '00:00:00'), 108) AS HoraRevision,
    Estado
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE FechaCumplido IS NOT NULL AND FechaCumplido > 0
ORDER BY FechaCumplido DESC, HoraCumplido DESC;

PRINT ''

-- ============================================================================
-- 11. ANÁLISIS DE LÓGICA DE CÁLCULO DE PRÓXIMA APLICACIÓN
-- ============================================================================

PRINT '============================================================================'
PRINT '11. VERIFICACIÓN DE CÁLCULO DE PRÓXIMA APLICACIÓN'
PRINT '============================================================================'

PRINT '-- Verificar si FechaProximo se calcula correctamente basado en FechaCumplido + Frecuencia:'

SELECT TOP 20
    NroIndicacion,
    Frecuencia,
    fa.Intervalo AS 'Intervalo (min)',
    -- Última aplicación
    CONVERT(varchar(19), 
        DATEADD(SECOND, HoraCumplido / 100,
            DATEADD(day, NULLIF(FechaCumplido,0) - 4, '1801-01-01')
        ), 120) AS 'Ultima Aplicacion',
    -- Próxima aplicación registrada
    CONVERT(varchar(19), 
        DATEADD(SECOND, HoraProximo / 100,
            DATEADD(day, NULLIF(FechaProximo,0) - 4, '1801-01-01')
        ), 120) AS 'Proxima Registrada',
    -- Próxima aplicación calculada (debería ser)
    CONVERT(varchar(19), 
        DATEADD(MINUTE, ISNULL(fa.Intervalo, 0),
            DATEADD(SECOND, HoraCumplido / 100,
                DATEADD(day, NULLIF(FechaCumplido,0) - 4, '1801-01-01')
            )
        ), 120) AS 'Proxima Calculada',
    -- Diferencia en minutos
    CASE 
        WHEN FechaProximo > 0 AND fa.Intervalo IS NOT NULL THEN
            DATEDIFF(MINUTE,
                DATEADD(SECOND, HoraProximo / 100,
                    DATEADD(day, NULLIF(FechaProximo,0) - 4, '1801-01-01')
                ),
                DATEADD(MINUTE, fa.Intervalo,
                    DATEADD(SECOND, HoraCumplido / 100,
                        DATEADD(day, NULLIF(FechaCumplido,0) - 4, '1801-01-01')
                    )
                )
            )
        ELSE NULL
    END AS 'Diferencia (min)'
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE FechaCumplido > 0 
    AND FechaProximo > 0
    AND fa.Intervalo IS NOT NULL
ORDER BY NroIndicacion DESC;

PRINT ''

-- ============================================================================
-- 12. RESUMEN Y RECOMENDACIONES
-- ============================================================================

PRINT '============================================================================'
PRINT '12. RESUMEN Y HALLAZGOS CLAVE'
PRINT '============================================================================'
PRINT ''
PRINT 'HALLAZGOS CLAVE:'
PRINT '----------------'
PRINT '1. PUNTO DE ANCLAJE: FechaCumplido/HoraCumplido representa la última aplicación'
PRINT '2. FRECUENCIA: Campo Frecuencia vincula con imFrecuenciasAdmin.Valor'
PRINT '3. INTERVALO: imFrecuenciasAdmin.Intervalo contiene minutos entre aplicaciones'
PRINT '4. PRÓXIMA APLICACIÓN: FechaProximo/HoraProximo debe calcularse como:'
PRINT '   FechaCumplido + HoraCumplido + Intervalo (en minutos)'
PRINT '5. ESTADO: Campo Estado (char(1)) puede usarse para almacenar estado actual'
PRINT ''
PRINT 'TABLAS RELACIONADAS IDENTIFICADAS:'
PRINT '-----------------------------------'
PRINT '- imInterIndMedicas: Tabla principal de indicaciones'
PRINT '- imFrecuenciasAdmin: Tabla de frecuencias con intervalos en minutos'
PRINT '- imInterCtrlMedicamento: Registros de aplicación de medicamentos'
PRINT '- imInterCtrlFrecuente: Registros de controles frecuentes (signos vitales)'
PRINT '- imInterCtrlDieta: Registros de aplicación de dietas'
PRINT ''
PRINT 'LÓGICA DE ESTADOS PROPUESTA:'
PRINT '-----------------------------'
PRINT 'ROJO (Vencida):     Tiempo actual > FechaProximo + HoraProximo'
PRINT 'AZUL (Urgente):     Falta < 10 minutos para FechaProximo + HoraProximo'
PRINT 'AMARILLO (Pronto):  Falta < 30 minutos para FechaProximo + HoraProximo'
PRINT 'CELESTE (Cercano):  Falta < 60 minutos para FechaProximo + HoraProximo'
PRINT 'VERDE (A tiempo):   Falta >= 60 minutos para FechaProximo + HoraProximo'
PRINT ''
PRINT '============================================================================'
PRINT 'FIN DEL ANÁLISIS'
PRINT '============================================================================'
