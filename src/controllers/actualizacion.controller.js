/**
 * Controlador temporal para ejecutar actualización masiva de indicaciones
 */

const { executeQuery } = require("../models/db");

/**
 * Ejecuta la actualización masiva de FechaProximo/HoraProximo
 */
const ejecutarActualizacionMasiva = async (req, res) => {
    try {
        console.log('============================================================================');
        console.log('INICIANDO ACTUALIZACIÓN MASIVA DE INDICACIONES');
        console.log('============================================================================');
        
        // 1. Verificación inicial
        const verificacion = await executeQuery(`
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
            WHERE iim.FechaCumplido > 0 AND fa.Intervalo IS NOT NULL
        `);
        
        console.log('Verificación inicial:', verificacion);
        
        // 2. Ejecutar actualización directa sin tabla temporal
        // IMPORTANTE: Intervalo está en formato Clarion TIME
        // Conversión: ((Intervalo - 1) * 10) / 1000 / 60 = minutos
        const resultado = await executeQuery(`
            UPDATE iim
            SET 
                iim.FechaProximo = DATEDIFF(DAY, '1800-12-28',
                    DATEADD(MINUTE, ((fa.Intervalo - 1) * 10) / 1000 / 60,
                        DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                            DATEADD(day, iim.FechaCumplido, '1800-12-28')
                        )
                    )
                ),
                iim.HoraProximo = (DATEDIFF(MILLISECOND, '00:00:00',
                    CONVERT(time,
                        DATEADD(MINUTE, ((fa.Intervalo - 1) * 10) / 1000 / 60,
                            DATEADD(ms, (iim.HoraCumplido - 1) * 10, '00:00:00')
                        )
                    )
                ) / 10) + 1
            FROM imInterIndMedicas iim
            INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
            WHERE iim.FechaCumplido IS NOT NULL 
              AND iim.FechaCumplido > 0
              AND fa.Intervalo IS NOT NULL
              AND fa.Intervalo > 0;
            
            SELECT @@ROWCOUNT AS FilasActualizadas;
        `);
        
        console.log('Resultado actualización:', resultado);
        
        // 5. Verificación post-actualización
        const verificacionPost = await executeQuery(`
            SELECT TOP 5
                iim.NroIndicacion,
                iim.AliasMedicamento,
                iim.Frecuencia,
                fa.Intervalo AS Intervalo_Min,
                CONVERT(varchar(19), 
                    DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                        DATEADD(day, iim.FechaCumplido, '1800-12-28')
                    ), 120) AS UltimaAplicacion,
                CONVERT(varchar(19), 
                    DATEADD(ms, (iim.HoraProximo - 1) * 10,
                        DATEADD(day, iim.FechaProximo, '1800-12-28')
                    ), 120) AS ProximaAplicacion,
                DATEDIFF(MINUTE,
                    DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                        DATEADD(day, iim.FechaCumplido, '1800-12-28')
                    ),
                    DATEADD(ms, (iim.HoraProximo - 1) * 10,
                        DATEADD(day, iim.FechaProximo, '1800-12-28')
                    )
                ) AS Diferencia_Min
            FROM imInterIndMedicas iim
            INNER JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
            WHERE iim.FechaCumplido > 0
              AND iim.FechaProximo > 0
            ORDER BY iim.NroIndicacion DESC
        `);
        
        // 6. Verificación DIPIRONA
        const dipirona = await executeQuery(`
            SELECT 
                iim.NroIndicacion,
                iim.AliasMedicamento,
                iim.Frecuencia,
                fa.Intervalo AS Intervalo_Min,
                CONVERT(varchar(19), 
                    DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                        DATEADD(day, iim.FechaCumplido, '1800-12-28')
                    ), 120) AS UltimaAplicacion,
                CONVERT(varchar(19), 
                    DATEADD(ms, (iim.HoraProximo - 1) * 10,
                        DATEADD(day, iim.FechaProximo, '1800-12-28')
                    ), 120) AS ProximaAplicacion,
                iim.Estado
            FROM imInterIndMedicas iim
            LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
            WHERE iim.AliasMedicamento LIKE '%DIPIRONA%'
              AND iim.FechaCumplido > 0
            ORDER BY iim.NroIndicacion DESC
        `);
        
        console.log('============================================================================');
        console.log('✅ ACTUALIZACIÓN COMPLETADA EXITOSAMENTE');
        console.log('============================================================================');
        
        res.json({
            success: true,
            message: 'Actualización completada exitosamente',
            verificacionInicial: verificacion,
            filasActualizadas: resultado[0]?.FilasActualizadas || 0,
            muestraPost: verificacionPost,
            dipirona: dipirona
        });
        
    } catch (error) {
        console.error('Error en actualización masiva:', error);
        res.status(500).json({
            success: false,
            message: 'Error al ejecutar actualización',
            error: error.message
        });
    }
};

/**
 * Verificar valores de Intervalo en imFrecuenciasAdmin
 */
const verificarFrecuencias = async (req, res) => {
    try {
        const frecuencias = await executeQuery(`
            SELECT 
                fa.Valor,
                fa.Intervalo AS Intervalo_RAW,
                -- Convertir Intervalo de Clarion TIME a minutos
                ((fa.Intervalo - 1) * 10) / 1000 / 60 AS Intervalo_Clarion_Minutos,
                -- Usar directamente como minutos
                fa.Intervalo AS Intervalo_Directo_Minutos
            FROM imFrecuenciasAdmin fa
            WHERE fa.Intervalo IS NOT NULL
              AND (fa.Valor LIKE '%3 VECES%' OR fa.Valor LIKE '%CADA 6%' OR fa.Valor LIKE '%CADA HORA%')
            ORDER BY fa.Valor
        `);
        
        res.json({
            success: true,
            frecuencias: frecuencias
        });
    } catch (error) {
        console.error('Error verificando frecuencias:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

module.exports = {
    ejecutarActualizacionMasiva,
    verificarFrecuencias
};
