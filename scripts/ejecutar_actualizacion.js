/**
 * Script para ejecutar la actualización masiva de FechaProximo/HoraProximo
 * Usa la conexión del backend para ejecutar el SQL
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '1433'),
    options: {
        encrypt: false,
        trustServerCertificate: true,
        instanceName: process.env.DB_INSTANCE || '',
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },
    requestTimeout: 60000,
};

async function ejecutarActualizacion() {
    let pool;
    
    try {
        console.log('============================================================================');
        console.log('EJECUTANDO ACTUALIZACIÓN MASIVA DE INDICACIONES');
        console.log('============================================================================');
        console.log('');
        console.log('Conectando a la base de datos...');
        console.log(`Servidor: ${config.server}\\${config.options.instanceName}`);
        console.log(`Base de datos: ${config.database}`);
        console.log('');
        
        // Conectar a la base de datos
        pool = await sql.connect(config);
        console.log('✅ Conexión establecida');
        console.log('');
        
        // 1. VERIFICACIÓN INICIAL
        console.log('1. VERIFICACIÓN INICIAL:');
        console.log('------------------------------------------------');
        const verificacion = await pool.request().query(`
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
        console.table(verificacion.recordset);
        console.log('');
        
        // 2. MUESTRA ANTES DE ACTUALIZAR
        console.log('2. MUESTRA DE INDICACIONES (primeras 5):');
        console.log('------------------------------------------------');
        const muestra = await pool.request().query(`
            SELECT TOP 5
                iim.NroIndicacion,
                iim.AliasMedicamento,
                iim.Frecuencia,
                fa.Intervalo AS Intervalo_Min,
                iim.FechaCumplido AS FechaCumplido_RAW,
                iim.FechaProximo AS FechaProximo_RAW_VIEJO,
                CONVERT(varchar(19), 
                    DATEADD(ms, (NULLIF(iim.HoraCumplido,0) - 1) * 10,
                        DATEADD(day, iim.FechaCumplido, '1800-12-28')
                    ), 120) AS UltimaAplicacion_CORRECTO
            FROM imInterIndMedicas iim
            LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
            WHERE iim.FechaCumplido > 0
              AND fa.Intervalo IS NOT NULL
            ORDER BY iim.NroIndicacion DESC
        `);
        console.table(muestra.recordset);
        console.log('');
        
        // 3. EJECUTAR ACTUALIZACIÓN
        console.log('3. EJECUTANDO ACTUALIZACIÓN CON CONVERSIONES CORRECTAS...');
        console.log('------------------------------------------------');
        
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            // Crear tabla temporal
            await transaction.request().query(`
                CREATE TABLE #TempCalculos (
                    NroIndicacion INT,
                    FechaProximoNuevo INT,
                    HoraProximoNuevo INT
                )
            `);
            
            // Calcular nuevos valores
            await transaction.request().query(`
                INSERT INTO #TempCalculos (NroIndicacion, FechaProximoNuevo, HoraProximoNuevo)
                SELECT 
                    iim.NroIndicacion,
                    DATEDIFF(DAY, '1800-12-28',
                        DATEADD(MINUTE, fa.Intervalo,
                            DATEADD(ms, (iim.HoraCumplido - 1) * 10,
                                DATEADD(day, iim.FechaCumplido, '1800-12-28')
                            )
                        )
                    ) AS FechaProximoNuevo,
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
                  AND fa.Intervalo IS NOT NULL
            `);
            
            // Actualizar tabla principal
            const resultado = await transaction.request().query(`
                UPDATE iim
                SET 
                    iim.FechaProximo = tmp.FechaProximoNuevo,
                    iim.HoraProximo = tmp.HoraProximoNuevo
                FROM imInterIndMedicas iim
                INNER JOIN #TempCalculos tmp ON iim.NroIndicacion = tmp.NroIndicacion
            `);
            
            console.log(`✅ Indicaciones actualizadas: ${resultado.rowsAffected[0]}`);
            console.log('');
            
            // 4. VERIFICACIÓN POST-ACTUALIZACIÓN
            console.log('4. VERIFICACIÓN POST-ACTUALIZACIÓN (primeras 5):');
            console.log('------------------------------------------------');
            const verificacionPost = await transaction.request().query(`
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
                        ), 120) AS ProximaAplicacion_NUEVO,
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
            console.table(verificacionPost.recordset);
            console.log('');
            
            // Limpiar tabla temporal
            await transaction.request().query(`DROP TABLE #TempCalculos`);
            
            // Commit
            await transaction.commit();
            
            console.log('============================================================================');
            console.log('✅ ACTUALIZACIÓN COMPLETADA EXITOSAMENTE');
            console.log('============================================================================');
            console.log('');
            
            // 5. VERIFICACIÓN ESPECÍFICA: DIPIRONA
            console.log('5. VERIFICACIÓN ESPECÍFICA: DIPIRONA 500 MG');
            console.log('------------------------------------------------');
            const dipirona = await pool.request().query(`
                SELECT 
                    iim.NroIndicacion,
                    iim.AliasMedicamento,
                    iim.Frecuencia,
                    fa.Descripcion AS Frecuencia_Desc,
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
            console.table(dipirona.recordset);
            console.log('');
            
            console.log('============================================================================');
            console.log('IMPORTANTE: Refrescar el navegador (F5) para ver los cambios');
            console.log('============================================================================');
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
        
    } catch (error) {
        console.error('');
        console.error('============================================================================');
        console.error('❌ ERROR EN LA ACTUALIZACIÓN');
        console.error('============================================================================');
        console.error('Error:', error.message);
        console.error('');
        process.exit(1);
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

// Ejecutar
ejecutarActualizacion()
    .then(() => {
        console.log('Script finalizado correctamente');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Error fatal:', error);
        process.exit(1);
    });
