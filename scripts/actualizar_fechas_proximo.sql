-- ============================================================================
-- SCRIPT DE ACTUALIZACIÓN: Calcular FechaProximo/HoraProximo para Indicaciones Existentes
-- ============================================================================
-- Objetivo: Actualizar todas las indicaciones que ya fueron aplicadas pero
--           no tienen FechaProximo/HoraProximo calculada automáticamente
-- ============================================================================

PRINT '============================================================================'
PRINT 'ACTUALIZACIÓN MASIVA: FechaProximo/HoraProximo para Indicaciones Médicas'
PRINT '============================================================================'
PRINT ''

-- Verificar cuántas indicaciones necesitan actualización
PRINT '1. VERIFICACIÓN INICIAL:'
PRINT '------------------------------------------------'
SELECT 
    'Indicaciones aplicadas SIN FechaProximo' AS Tipo,
    COUNT(*) AS Cantidad
FROM imInterIndMedicas
WHERE FechaCumplido IS NOT NULL 
  AND FechaCumplido > 0
  AND (FechaProximo IS NULL OR FechaProximo = 0)
UNION ALL
SELECT 
    'Indicaciones aplicadas CON FechaProximo',
    COUNT(*)
FROM imInterIndMedicas
WHERE FechaCumplido IS NOT NULL 
  AND FechaCumplido > 0
  AND FechaProximo > 0;
PRINT ''

-- Mostrar muestra de indicaciones que se actualizarán
PRINT '2. MUESTRA DE INDICACIONES A ACTUALIZAR (primeras 5):'
PRINT '------------------------------------------------'
SELECT TOP 5
    iim.NroIndicacion,
    iim.NumeroVisita,
    iim.Frecuencia,
    fa.Intervalo AS 'Intervalo (min)',
    CONVERT(varchar(19), 
        DATEADD(SECOND, iim.HoraCumplido / 100,
            DATEADD(day, iim.FechaCumplido - 4, '1801-01-01')
        ), 120) AS 'Ultima Aplicacion',
    CONVERT(varchar(19), 
        DATEADD(MINUTE, ISNULL(fa.Intervalo, 0),
            DATEADD(SECOND, iim.HoraCumplido / 100,
                DATEADD(day, iim.FechaCumplido - 4, '1801-01-01')
            )
        ), 120) AS 'Proxima Calculada'
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE iim.FechaCumplido > 0
  AND (iim.FechaProximo IS NULL OR iim.FechaProximo = 0)
  AND fa.Intervalo IS NOT NULL;
PRINT ''

PRINT '3. EJECUTANDO ACTUALIZACIÓN...'
PRINT '------------------------------------------------'

-- ============================================================================
-- ACTUALIZACIÓN MASIVA
-- ============================================================================
-- Actualizar FechaProximo/HoraProximo para todas las indicaciones aplicadas
-- que tienen frecuencia válida pero no tienen próxima aplicación calculada

BEGIN TRANSACTION;

BEGIN TRY
    -- Actualizar indicaciones con frecuencia válida
    UPDATE iim
    SET 
        -- Calcular FechaProximo: Fecha de la próxima aplicación
        iim.FechaProximo = DATEDIFF(DAY, '1801-01-01', 
            DATEADD(MINUTE, fa.Intervalo,
                DATEADD(SECOND, iim.HoraCumplido / 100,
                    DATEADD(DAY, iim.FechaCumplido - 4, '1801-01-01')
                )
            )
        ) + 4,
        
        -- Calcular HoraProximo: Hora de la próxima aplicación en formato HHMMSS
        iim.HoraProximo = 
            DATEPART(HOUR, DATEADD(MINUTE, fa.Intervalo,
                DATEADD(SECOND, iim.HoraCumplido / 100, '1900-01-01 00:00:00')
            )) * 10000 +
            DATEPART(MINUTE, DATEADD(MINUTE, fa.Intervalo,
                DATEADD(SECOND, iim.HoraCumplido / 100, '1900-01-01 00:00:00')
            )) * 100 +
            DATEPART(SECOND, DATEADD(MINUTE, fa.Intervalo,
                DATEADD(SECOND, iim.HoraCumplido / 100, '1900-01-01 00:00:00')
            ))
    FROM imInterIndMedicas iim
    INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
    WHERE iim.FechaCumplido IS NOT NULL 
      AND iim.FechaCumplido > 0
      AND (iim.FechaProximo IS NULL OR iim.FechaProximo = 0)
      AND fa.Intervalo IS NOT NULL;
    
    -- Obtener número de filas actualizadas
    DECLARE @RowsUpdated INT = @@ROWCOUNT;
    
    PRINT ''
    PRINT 'Indicaciones actualizadas: ' + CAST(@RowsUpdated AS VARCHAR(10))
    PRINT ''
    
    -- Verificar algunas actualizaciones
    PRINT '4. VERIFICACIÓN POST-ACTUALIZACIÓN (primeras 5):'
    PRINT '------------------------------------------------'
    SELECT TOP 5
        iim.NroIndicacion,
        iim.Frecuencia,
        fa.Intervalo AS 'Intervalo (min)',
        CONVERT(varchar(19), 
            DATEADD(SECOND, iim.HoraCumplido / 100,
                DATEADD(day, iim.FechaCumplido - 4, '1801-01-01')
            ), 120) AS 'Ultima Aplicacion',
        CONVERT(varchar(19), 
            DATEADD(SECOND, iim.HoraProximo / 100,
                DATEADD(day, iim.FechaProximo - 4, '1801-01-01')
            ), 120) AS 'Proxima Aplicacion',
        DATEDIFF(MINUTE,
            DATEADD(SECOND, iim.HoraCumplido / 100,
                DATEADD(day, iim.FechaCumplido - 4, '1801-01-01')
            ),
            DATEADD(SECOND, iim.HoraProximo / 100,
                DATEADD(day, iim.FechaProximo - 4, '1801-01-01')
            )
        ) AS 'Diferencia (min)'
    FROM imInterIndMedicas iim
    INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
    WHERE iim.FechaCumplido > 0
      AND iim.FechaProximo > 0
    ORDER BY iim.NroIndicacion DESC;
    
    PRINT ''
    PRINT '5. RESUMEN FINAL:'
    PRINT '------------------------------------------------'
    SELECT 
        'Indicaciones con FechaProximo calculada' AS Estado,
        COUNT(*) AS Cantidad
    FROM imInterIndMedicas
    WHERE FechaCumplido > 0 AND FechaProximo > 0
    UNION ALL
    SELECT 
        'Indicaciones SIN FechaProximo (sin frecuencia)',
        COUNT(*)
    FROM imInterIndMedicas
    WHERE FechaCumplido > 0 
      AND (FechaProximo IS NULL OR FechaProximo = 0);
    
    COMMIT TRANSACTION;
    
    PRINT ''
    PRINT '============================================================================'
    PRINT 'ACTUALIZACIÓN COMPLETADA EXITOSAMENTE'
    PRINT '============================================================================'
    
END TRY
BEGIN CATCH
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
