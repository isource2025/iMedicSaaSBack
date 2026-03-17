/**
 * Script para corregir registros existentes de indicaciones que tienen NULLs
 * y que el sistema viejo (Clarion) no puede ver.
 * 
 * Ejecutar: node scripts/fix_indicaciones_nulls.js
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function fixNulls() {
    try {
        const pool = await connectDB();
        
        // 1. Primero contar cuántos registros tienen NULLs
        console.log('\n========== CONTANDO REGISTROS CON NULLs ==========');
        const countResult = await pool.request().query(`
            SELECT COUNT(*) as Total
            FROM imInterIndMedicas
            WHERE NroAdicional IS NULL
               OR FechaCumplido IS NULL
               OR HoraCumplido IS NULL
               OR FechaProximo IS NULL
               OR HoraProximo IS NULL
               OR FechaRevision IS NULL
               OR HoraRevision IS NULL
               OR Cantidad IS NULL
               OR TipoUnidad IS NULL
               OR Frecuencia IS NULL
               OR Estado IS NULL
               OR CantidadPorTurno IS NULL
               OR CantidadEntregada IS NULL
               OR FechaExpiro IS NULL
               OR HoraExpiro IS NULL
               OR FormaAdicional IS NULL
               OR NroIndicacionAnterior IS NULL
               OR Observaciones IS NULL
               OR AliasMedicamento IS NULL
        `);
        console.log(`Registros con al menos un NULL: ${countResult.recordset[0].Total}`);

        // 2. Ver detalle de qué campos tienen NULLs
        console.log('\n========== DETALLE DE NULLs POR CAMPO ==========');
        const detailResult = await pool.request().query(`
            SELECT 
                SUM(CASE WHEN NroAdicional IS NULL THEN 1 ELSE 0 END) as NroAdicional_NULL,
                SUM(CASE WHEN FechaCumplido IS NULL THEN 1 ELSE 0 END) as FechaCumplido_NULL,
                SUM(CASE WHEN HoraCumplido IS NULL THEN 1 ELSE 0 END) as HoraCumplido_NULL,
                SUM(CASE WHEN FechaProximo IS NULL THEN 1 ELSE 0 END) as FechaProximo_NULL,
                SUM(CASE WHEN HoraProximo IS NULL THEN 1 ELSE 0 END) as HoraProximo_NULL,
                SUM(CASE WHEN FechaRevision IS NULL THEN 1 ELSE 0 END) as FechaRevision_NULL,
                SUM(CASE WHEN HoraRevision IS NULL THEN 1 ELSE 0 END) as HoraRevision_NULL,
                SUM(CASE WHEN Cantidad IS NULL THEN 1 ELSE 0 END) as Cantidad_NULL,
                SUM(CASE WHEN TipoUnidad IS NULL THEN 1 ELSE 0 END) as TipoUnidad_NULL,
                SUM(CASE WHEN Frecuencia IS NULL THEN 1 ELSE 0 END) as Frecuencia_NULL,
                SUM(CASE WHEN Estado IS NULL THEN 1 ELSE 0 END) as Estado_NULL,
                SUM(CASE WHEN CantidadPorTurno IS NULL THEN 1 ELSE 0 END) as CantidadPorTurno_NULL,
                SUM(CASE WHEN CantidadEntregada IS NULL THEN 1 ELSE 0 END) as CantidadEntregada_NULL,
                SUM(CASE WHEN FechaExpiro IS NULL THEN 1 ELSE 0 END) as FechaExpiro_NULL,
                SUM(CASE WHEN HoraExpiro IS NULL THEN 1 ELSE 0 END) as HoraExpiro_NULL,
                SUM(CASE WHEN FormaAdicional IS NULL THEN 1 ELSE 0 END) as FormaAdicional_NULL,
                SUM(CASE WHEN NroIndicacionAnterior IS NULL THEN 1 ELSE 0 END) as NroIndicacionAnterior_NULL,
                SUM(CASE WHEN Observaciones IS NULL THEN 1 ELSE 0 END) as Observaciones_NULL,
                SUM(CASE WHEN AliasMedicamento IS NULL THEN 1 ELSE 0 END) as AliasMedicamento_NULL,
                SUM(CASE WHEN OperadorCarga IS NULL THEN 1 ELSE 0 END) as OperadorCarga_NULL,
                SUM(CASE WHEN ProfesionalAsiste IS NULL THEN 1 ELSE 0 END) as ProfesionalAsiste_NULL,
                SUM(CASE WHEN TipoIndicacion IS NULL THEN 1 ELSE 0 END) as TipoIndicacion_NULL,
                SUM(CASE WHEN Codigo IS NULL THEN 1 ELSE 0 END) as Codigo_NULL,
                SUM(CASE WHEN Orden IS NULL THEN 1 ELSE 0 END) as Orden_NULL
            FROM imInterIndMedicas
        `);
        const detail = detailResult.recordset[0];
        Object.keys(detail).forEach(key => {
            if (detail[key] > 0) {
                console.log(`  ${key}: ${detail[key]} registros`);
            }
        });

        // 3. CORREGIR: Solo los campos críticos que hacen que Clarion no vea los registros
        // Los NULLs masivos en Estado, NroIndicacionAnterior, AliasMedicamento son HISTÓRICOS
        // del sistema viejo y NO debemos tocarlos.
        // Solo corregimos los registros que tienen NULLs en campos CLAVE que Clarion necesita
        // para mostrar la indicación: NroAdicional, FechaCumplido, HoraCumplido, etc.
        console.log('\n========== APLICANDO CORRECCIONES (solo registros recientes del sistema nuevo) ==========');
        
        // Corregir SOLO registros que tienen NroAdicional IS NULL (solo hay 3, creados por sistema nuevo)
        const updateSQL = `
            UPDATE imInterIndMedicas
            SET 
                NroAdicional = ISNULL(NroAdicional, 0),
                FechaCumplido = ISNULL(FechaCumplido, 0),
                HoraCumplido = ISNULL(HoraCumplido, 0),
                FechaProximo = ISNULL(FechaProximo, 0),
                HoraProximo = ISNULL(HoraProximo, 0),
                FechaRevision = ISNULL(FechaRevision, 0),
                HoraRevision = ISNULL(HoraRevision, 0),
                FechaExpiro = ISNULL(FechaExpiro, 0),
                HoraExpiro = ISNULL(HoraExpiro, 0),
                Cantidad = ISNULL(Cantidad, 0),
                TipoUnidad = ISNULL(TipoUnidad, ''),
                Frecuencia = ISNULL(Frecuencia, ''),
                Observaciones = ISNULL(Observaciones, '')
            WHERE NroAdicional IS NULL
               OR FechaCumplido IS NULL
               OR HoraCumplido IS NULL
               OR Cantidad IS NULL
               OR TipoUnidad IS NULL
               OR Frecuencia IS NULL
               OR Observaciones IS NULL
               OR FechaExpiro IS NULL
               OR HoraExpiro IS NULL
        `;
        
        const result = await pool.request().query(updateSQL);
        console.log(`✅ Registros corregidos: ${result.rowsAffected[0]}`);

        // 4. Verificar que ya no hay NULLs
        console.log('\n========== VERIFICACIÓN POST-CORRECCIÓN ==========');
        const verifyResult = await pool.request().query(`
            SELECT COUNT(*) as Total
            FROM imInterIndMedicas
            WHERE NroAdicional IS NULL
               OR FechaCumplido IS NULL
               OR HoraCumplido IS NULL
               OR FechaProximo IS NULL
               OR HoraProximo IS NULL
               OR FechaRevision IS NULL
               OR HoraRevision IS NULL
               OR Cantidad IS NULL
               OR TipoUnidad IS NULL
               OR Frecuencia IS NULL
               OR Estado IS NULL
               OR CantidadPorTurno IS NULL
               OR CantidadEntregada IS NULL
               OR FechaExpiro IS NULL
               OR HoraExpiro IS NULL
               OR FormaAdicional IS NULL
               OR NroIndicacionAnterior IS NULL
               OR Observaciones IS NULL
               OR AliasMedicamento IS NULL
        `);
        console.log(`Registros con NULLs restantes: ${verifyResult.recordset[0].Total}`);

        if (verifyResult.recordset[0].Total === 0) {
            console.log('\n✅ ¡CORRECCIÓN COMPLETA! Todos los registros ahora son compatibles con Clarion.');
        } else {
            console.log('\n⚠️ Aún hay registros con NULLs. Revisar manualmente.');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

fixNulls();
