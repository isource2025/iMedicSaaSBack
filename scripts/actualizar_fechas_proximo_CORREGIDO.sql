-- ============================================================================
-- SCRIPT DE ACTUALIZACIÓN CORREGIDO: Recalcular FechaProximo/HoraProximo
-- ============================================================================
-- Objetivo: RECALCULAR todas las indicaciones aplicadas usando las 
--           conversiones CORRECTAS de fechas y horas Clarion
-- Fecha: 28/01/2026
-- ============================================================================

PRINT '============================================================================'
PRINT 'ACTUALIZACIÓN MASIVA CORREGIDA: FechaProximo/HoraProximo'
PRINT '============================================================================'
PRINT ''

-- ============================================================================
-- IMPORTANTE: Este script RECALCULA todas las indicaciones aplicadas
-- usando las conversiones CORRECTAS:
-- - Epoch Clarion: 28/12/1800 (no 01/01/1801)
-- - Hora Clarion: (milisegundos / 10) + 1 (no HHMMSS)
-- ============================================================================

-- 1. VERIFICACIÓN INICIAL
PRINT '1. VERIFICACIÓN INICIAL:'
PRINT '------------------------------------------------'
SELECT 
    'Total indicaciones aplicadas' AS Tipo,
    COUNT(*) AS Cantidad
FROM imInterIndMedicas
WHERE FechaCumplido IS NOT NULL AND FechaCumplido > 0
UNION ALL
SELECT 
    'Con frecuencia válida',
    COUNT(*)
FROM imInterIndMedicas iim
INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE iim.FechaCumplido > 0 AND fa.Intervalo IS NOT NULL;
PRINT ''

-- 2. MUESTRA DE DATOS ACTUALES (ANTES DE ACTUALIZAR)
PRINT '2. MUESTRA DE INDICACIONES (primeras 5):'
PRINT '------------------------------------------------'
SELECT TOP 5
    iim.NroIndicacion,
    iim.AliasMedicamento,
    iim.Frecuencia,
    fa.Intervalo AS 'Intervalo_Min',
    
    -- Valores RAW
    iim.FechaCumplido AS 'FechaCumplido_RAW',
    iim.HoraCumplido AS 'HoraCumplido_RAW',
    iim.FechaProximo AS 'FechaProximo_RAW_VIEJO',
    
    -- ✅ Conversión CORRECTA de última aplicación
    CONVERT(varchar(19), 
        DATEADD(ms, (NULLIF(iim.HoraCumplido,0) - 1) * 10,
            DATEADD(day, iim.FechaCumplido, '1800-12-28')
        ), 120) AS 'UltimaAplicacion_CORRECTO',
    
    -- ❌ Conversión INCORRECTA (la vieja)
    CONVERT(varchar(19), 
        DATEADD(SECOND, iim.HoraProximo / 100,
            DATEADD(day, iim.FechaProximo - 4, '1801-01-01')
        ), 120) AS 'ProximaAplicacion_VIEJO_INCORRECTO'
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE iim.FechaCumplido > 0
  AND fa.Intervalo IS NOT NULL
ORDER BY iim.NroIndicacion DESC;
PRINT ''

PRINT '3. EJECUTANDO ACTUALIZACIÓN CON CONVERSIONES CORRECTAS...'
PRINT '------------------------------------------------'

-- ============================================================================
-- ACTUALIZACIÓN MASIVA CON CONVERSIONES CORRECTAS
-- ============================================================================

BEGIN TRANSACTION;

BEGIN TRY
    -- Crear tabla temporal para cálculos
    CREATE TABLE #TempCalculos (
        NroIndicacion INT,
        FechaProximoNuevo INT,
        HoraProximoNuevo INT
    );
    
    -- Calcular nuevos valores usando conversiones CORRECTAS
    INSERT INTO #TempCalculos (NroIndicacion, FechaProximoNuevo, HoraProximoNuevo)
    SELECT 
        iim.NroIndicacion,
        
        -- ✅ CALCULAR FechaProximo CORRECTO
        -- 1. Convertir FechaCumplido + HoraCumplido a datetime
        -- 2. Sumar intervalo en minutos
        -- 3. Convertir de vuelta a formato Clarion DATE
        DATEDIFF(DAY, '1800-12-28',
            DATEADD(MINUTE, fa.Intervalo,
                DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                    DATEADD(day, iim.FechaCumplido, '1800-12-28')
                )
            )
        ) AS FechaProximoNuevo,
        
        -- ✅ CALCULAR HoraProximo CORRECTO (formato Clarion TIME)
        -- Formato: (milisegundos / 10) + 1
        (DATEDIFF(MILLISECOND, '00:00:00',
            CONVERT(time,
                DATEADD(MINUTE, fa.Intervalo,
                    DATEADD(ms, (iim.HoraCumplido - 1) * 10, '00:00:00')
                )
            )
        ) / 10) + 1 AS HoraProximoNuevo
    FROM imInterIndMedicas iim
    INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
    WHERE iim.FechaCumplido IS NOT NULL 
      AND iim.FechaCumplido > 0
      AND fa.Intervalo IS NOT NULL;
    
    -- Actualizar tabla principal
    UPDATE iim
    SET 
        iim.FechaProximo = tmp.FechaProximoNuevo,
        iim.HoraProximo = tmp.HoraProximoNuevo
    FROM imInterIndMedicas iim
    INNER JOIN #TempCalculos tmp ON iim.NroIndicacion = tmp.NroIndicacion;
    
    DECLARE @RowsUpdated INT = @@ROWCOUNT;
    
    PRINT ''
    PRINT 'Indicaciones actualizadas: ' + CAST(@RowsUpdated AS VARCHAR(10))
    PRINT ''
    
    -- 4. VERIFICACIÓN POST-ACTUALIZACIÓN
    PRINT '4. VERIFICACIÓN POST-ACTUALIZACIÓN (primeras 5):'
    PRINT '------------------------------------------------'
    SELECT TOP 5
        iim.NroIndicacion,
        iim.AliasMedicamento,
        iim.Frecuencia,
        fa.Intervalo AS 'Intervalo_Min',
        
        -- ✅ Última aplicación (CORRECTA)
        CONVERT(varchar(19), 
            DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                DATEADD(day, iim.FechaCumplido, '1800-12-28')
            ), 120) AS 'UltimaAplicacion',
        
        -- ✅ Próxima aplicación (CORREGIDA)
        CONVERT(varchar(19), 
            DATEADD(ms, (iim.HoraProximo - 1) * 10,
                DATEADD(day, iim.FechaProximo, '1800-12-28')
            ), 120) AS 'ProximaAplicacion_NUEVO',
        
        -- Diferencia en minutos (debe coincidir con Intervalo)
        DATEDIFF(MINUTE,
            DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                DATEADD(day, iim.FechaCumplido, '1800-12-28')
            ),
            DATEADD(ms, (iim.HoraProximo - 1) * 10,
                DATEADD(day, iim.FechaProximo, '1800-12-28')
            )
        ) AS 'Diferencia_Min'
    FROM imInterIndMedicas iim
    INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
    WHERE iim.FechaCumplido > 0
      AND iim.FechaProximo > 0
    ORDER BY iim.NroIndicacion DESC;
    
    -- Limpiar tabla temporal
    DROP TABLE #TempCalculos;
    
    PRINT ''
    PRINT '5. RESUMEN FINAL:'
    PRINT '------------------------------------------------'
    SELECT 
        'Indicaciones actualizadas correctamente' AS Estado,
        COUNT(*) AS Cantidad
    FROM imInterIndMedicas iim
    INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
    WHERE iim.FechaCumplido > 0 
      AND iim.FechaProximo > 0
      AND fa.Intervalo IS NOT NULL;
    
    COMMIT TRANSACTION;
    
    PRINT ''
    PRINT '============================================================================'
    PRINT 'ACTUALIZACIÓN COMPLETADA EXITOSAMENTE'
    PRINT '============================================================================'
    PRINT ''
    PRINT 'IMPORTANTE: Reiniciar el backend para que los cambios se reflejen'
    PRINT '============================================================================'
    
END TRY
BEGIN CATCH
    IF OBJECT_ID('tempdb..#TempCalculos') IS NOT NULL
        DROP TABLE #TempCalculos;
        
    ROLLBACK TRANSACTION;
    
    PRINT ''
    PRINT '============================================================================'
    PRINT 'ERROR EN LA ACTUALIZACIÓN'
    PRINT '============================================================================'
    PRINT 'Error: ' + ERROR_MESSAGE()
    PRINT 'Línea: ' + CAST(ERROR_LINE() AS VARCHAR(10))
    PRINT ''
    PRINT 'La transacción ha sido revertida.'
    PRINT '============================================================================'
END CATCH;

-- ============================================================================
-- VERIFICACIÓN ESPECÍFICA: DIPIRONA 500 MG
-- ============================================================================
PRINT ''
PRINT '6. VERIFICACIÓN ESPECÍFICA: DIPIRONA 500 MG'
PRINT '------------------------------------------------'
SELECT 
    iim.NroIndicacion,
    iim.AliasMedicamento,
    iim.Frecuencia,
    fa.Descripcion AS 'Frecuencia_Desc',
    fa.Intervalo AS 'Intervalo_Min',
    
    -- Última aplicación
    CONVERT(varchar(19), 
        DATEADD(ms, (iim.HoraCumplido - 1) * 10,
            DATEADD(day, iim.FechaCumplido, '1800-12-28')
        ), 120) AS 'UltimaAplicacion',
    
    -- Próxima aplicación (CORREGIDA)
    CONVERT(varchar(19), 
        DATEADD(ms, (iim.HoraProximo - 1) * 10,
            DATEADD(day, iim.FechaProximo, '1800-12-28')
        ), 120) AS 'ProximaAplicacion',
    
    iim.Estado
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE iim.AliasMedicamento LIKE '%DIPIRONA%'
  AND iim.FechaCumplido > 0
ORDER BY iim.NroIndicacion DESC;

PRINT ''
PRINT '============================================================================'
PRINT 'FIN DEL SCRIPT'
PRINT '============================================================================'
