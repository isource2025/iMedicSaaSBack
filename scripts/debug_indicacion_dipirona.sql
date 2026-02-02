-- Script de debug para verificar datos de la indicación DIPIRONA 500 MG
-- Fecha: 28/01/2026

-- 1. Buscar la indicación específica
SELECT TOP 5
    iim.NroIndicacion,
    iim.NumeroVisita,
    iim.AliasMedicamento,
    iim.Frecuencia,
    
    -- Fechas/Horas RAW (valores Clarion sin convertir)
    iim.FechaCumplido AS 'FechaCumplido_RAW',
    iim.HoraCumplido AS 'HoraCumplido_RAW',
    iim.FechaProximo AS 'FechaProximo_RAW',
    iim.HoraProximo AS 'HoraProximo_RAW',
    iim.FechaRevision AS 'FechaRevision_RAW',
    iim.HoraRevision AS 'HoraRevision_RAW',
    iim.FechaCarga AS 'FechaCarga_RAW',
    iim.HoraCarga AS 'HoraCarga_RAW',
    
    -- ✅ Conversión CORRECTA usando epoch 1800-12-28
    CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaCumplido,0), '1800-12-28'), 23) AS 'FechaCumplido_CORRECTO',
    CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraCumplido,0) - 1) * 10, 0), 108) AS 'HoraCumplido_CORRECTO',
    
    CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaProximo,0), '1800-12-28'), 23) AS 'FechaProximo_CORRECTO',
    CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraProximo,0) - 1) * 10, 0), 108) AS 'HoraProximo_CORRECTO',
    
    CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaRevision,0), '1800-12-28'), 23) AS 'FechaRevision_CORRECTO',
    CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraRevision,0) - 1) * 10, 0), 108) AS 'HoraRevision_CORRECTO',
    
    -- ❌ Conversión INCORRECTA (la que estaba antes)
    CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaProximo,0) - 4, '1801-01-01'), 23) AS 'FechaProximo_INCORRECTO',
    
    -- ✅ Última aplicación ISO completo
    CASE 
        WHEN iim.FechaCumplido IS NOT NULL AND iim.FechaCumplido > 0 THEN
            CONVERT(varchar(19), 
                DATEADD(ms, (NULLIF(iim.HoraCumplido,0) - 1) * 10,
                    DATEADD(day, iim.FechaCumplido, '1800-12-28')
                ), 120)
        ELSE NULL
    END AS 'UltimaAplicacion_ISO',
    
    -- ✅ Próxima aplicación ISO completo
    CASE 
        WHEN iim.FechaProximo IS NOT NULL AND iim.FechaProximo > 0 THEN
            CONVERT(varchar(19), 
                DATEADD(ms, (NULLIF(iim.HoraProximo,0) - 1) * 10,
                    DATEADD(day, iim.FechaProximo, '1800-12-28')
                ), 120)
        ELSE NULL
    END AS 'ProximaAplicacion_ISO',
    
    -- Intervalo de frecuencia
    fa.Intervalo AS 'Intervalo_Minutos',
    
    iim.Estado
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
WHERE iim.AliasMedicamento LIKE '%DIPIRONA%'
ORDER BY iim.FechaCarga DESC;

-- 2. Verificar frecuencias disponibles
SELECT 
    Valor AS 'Codigo_Frecuencia',
    Descripcion,
    Intervalo AS 'Intervalo_Minutos'
FROM imFrecuenciasAdmin
WHERE Valor IN (
    SELECT DISTINCT Frecuencia 
    FROM imInterIndMedicas 
    WHERE AliasMedicamento LIKE '%DIPIRONA%'
);

-- 3. Verificar si hay aplicaciones registradas
SELECT TOP 5
    icm.IdCtrlMedica,
    icm.NroIndicacion,
    icm.FechaControl AS 'FechaControl_RAW',
    icm.HoraControl AS 'HoraControl_RAW',
    CONVERT(varchar(10), DATEADD(day, NULLIF(icm.FechaControl,0), '1800-12-28'), 23) AS 'FechaControl_CORRECTO',
    CONVERT(varchar(8), DATEADD(ms, (NULLIF(icm.HoraControl,0) - 1) * 10, 0), 108) AS 'HoraControl_CORRECTO'
FROM imInterCtrlMedicamento icm
WHERE icm.NroIndicacion IN (
    SELECT NroIndicacion 
    FROM imInterIndMedicas 
    WHERE AliasMedicamento LIKE '%DIPIRONA%'
)
ORDER BY icm.FechaControl DESC;

-- 4. Comparación de conversiones para entender el problema
PRINT '=== ANÁLISIS DE CONVERSIÓN DE FECHAS ==='
PRINT 'Epoch Clarion correcto: 28/12/1800'
PRINT 'Epoch incorrecto usado antes: 01/01/1801 con offset -4'
PRINT ''
PRINT 'Ejemplo con valor Clarion 84500:'
SELECT 
    84500 AS 'Valor_Clarion',
    DATEADD(day, 84500, '1800-12-28') AS 'Fecha_CORRECTA',
    DATEADD(day, 84500 - 4, '1801-01-01') AS 'Fecha_INCORRECTA',
    DATEDIFF(day, 
        DATEADD(day, 84500 - 4, '1801-01-01'),
        DATEADD(day, 84500, '1800-12-28')
    ) AS 'Diferencia_Dias';
