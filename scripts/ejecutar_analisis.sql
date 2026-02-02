-- ============================================================================
-- ANÁLISIS RÁPIDO: Sistema de Estados de Indicaciones Médicas
-- ============================================================================

PRINT '============================================================================'
PRINT 'ANÁLISIS DE DATOS ACTUALES - Sistema de Indicaciones Médicas'
PRINT '============================================================================'
PRINT ''

-- 1. Verificar existencia de tabla de frecuencias
PRINT '1. TABLA DE FRECUENCIAS (imFrecuenciasAdmin):'
PRINT '------------------------------------------------'
SELECT TOP 10
    Valor AS Frecuencia,
    Intervalo AS 'Intervalo (min)',
    CAST(Intervalo / 60.0 AS DECIMAL(5,2)) AS 'Horas'
FROM imFrecuenciasAdmin
WHERE Intervalo IS NOT NULL
ORDER BY Intervalo;
PRINT ''

-- 2. Distribución de indicaciones por estado
PRINT '2. DISTRIBUCIÓN DE INDICACIONES POR ESTADO:'
PRINT '------------------------------------------------'
SELECT 
    ISNULL(Estado, 'NULL') AS Estado,
    COUNT(*) AS Cantidad
FROM imInterIndMedicas
GROUP BY Estado
ORDER BY COUNT(*) DESC;
PRINT ''

-- 3. Indicaciones aplicadas vs sin aplicar
PRINT '3. INDICACIONES APLICADAS VS SIN APLICAR:'
PRINT '------------------------------------------------'
SELECT 
    'Aplicadas (con FechaCumplido)' AS Tipo,
    COUNT(*) AS Cantidad
FROM imInterIndMedicas
WHERE FechaCumplido IS NOT NULL AND FechaCumplido > 0
UNION ALL
SELECT 
    'Sin Aplicar (sin FechaCumplido)',
    COUNT(*)
FROM imInterIndMedicas
WHERE FechaCumplido IS NULL OR FechaCumplido = 0;
PRINT ''

-- 4. Indicaciones con/sin próxima aplicación calculada
PRINT '4. INDICACIONES CON/SIN PRÓXIMA APLICACIÓN:'
PRINT '------------------------------------------------'
SELECT 
    'Con FechaProximo calculada' AS Tipo,
    COUNT(*) AS Cantidad
FROM imInterIndMedicas
WHERE FechaCumplido > 0 AND FechaProximo > 0
UNION ALL
SELECT 
    'Sin FechaProximo (PROBLEMA)',
    COUNT(*)
FROM imInterIndMedicas
WHERE FechaCumplido > 0 AND (FechaProximo IS NULL OR FechaProximo = 0);
PRINT ''

-- 5. Muestra de datos reales (últimas 5 indicaciones aplicadas)
PRINT '5. MUESTRA DE DATOS REALES (Últimas 5 aplicadas):'
PRINT '------------------------------------------------'
SELECT TOP 5
    NroIndicacion,
    NumeroVisita,
    Frecuencia,
    CONVERT(varchar(19), 
        DATEADD(SECOND, HoraCumplido / 100,
            DATEADD(day, NULLIF(FechaCumplido,0) - 4, '1801-01-01')
        ), 120) AS 'Ultima Aplicacion',
    CONVERT(varchar(19), 
        DATEADD(SECOND, HoraProximo / 100,
            DATEADD(day, NULLIF(FechaProximo,0) - 4, '1801-01-01')
        ), 120) AS 'Proxima Aplicacion',
    Estado
FROM imInterIndMedicas
WHERE FechaCumplido > 0
ORDER BY FechaCumplido DESC, HoraCumplido DESC;
PRINT ''

PRINT '============================================================================'
PRINT 'FIN DEL ANÁLISIS'
PRINT '============================================================================'
