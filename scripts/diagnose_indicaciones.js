/**
 * Script de diagnóstico para comparar indicaciones creadas por sistema viejo vs nuevo
 * Ejecutar: node scripts/diagnose_indicaciones.js
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');

async function diagnose() {
    try {
        const pool = await connectDB();
        
        // 1. Ver la estructura completa de la tabla
        console.log('\n========== ESTRUCTURA DE imInterIndMedicas ==========');
        const columns = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'imInterIndMedicas'
            ORDER BY ORDINAL_POSITION
        `);
        columns.recordset.forEach(col => {
            console.log(`  ${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE.padEnd(15)} ${col.IS_NULLABLE.padEnd(5)} Default: ${col.COLUMN_DEFAULT || 'NULL'}`);
        });

        // 2. Ver los últimos 5 registros creados (probablemente por el sistema nuevo)
        console.log('\n========== ÚLTIMOS 10 REGISTROS (más recientes) ==========');
        const ultimos = await pool.request().query(`
            SELECT TOP 10 *
            FROM imInterIndMedicas
            ORDER BY NroIndicacion DESC
        `);
        ultimos.recordset.forEach(row => {
            console.log('\n--- NroIndicacion:', row.NroIndicacion, '---');
            Object.keys(row).forEach(key => {
                if (row[key] !== null && row[key] !== undefined && row[key] !== '' && row[key] !== 0) {
                    console.log(`  ${key}: ${row[key]}`);
                }
            });
        });

        // 3. Buscar registros que SÍ se ven en el viejo (los más antiguos con datos completos)
        console.log('\n========== REGISTROS ANTIGUOS (creados por sistema viejo) - TOP 5 ==========');
        const antiguos = await pool.request().query(`
            SELECT TOP 5 *
            FROM imInterIndMedicas
            WHERE NroIndicacion < (SELECT MAX(NroIndicacion) - 50 FROM imInterIndMedicas)
              AND FechaCarga > 0
              AND (NroAdicional IS NULL OR NroAdicional = 0)
            ORDER BY NroIndicacion DESC
        `);
        antiguos.recordset.forEach(row => {
            console.log('\n--- NroIndicacion:', row.NroIndicacion, '(VIEJO) ---');
            Object.keys(row).forEach(key => {
                console.log(`  ${key}: ${JSON.stringify(row[key])}`);
            });
        });

        // 4. Comparar un registro viejo vs nuevo campo por campo
        console.log('\n========== COMPARACIÓN CAMPO POR CAMPO ==========');
        const viejo = antiguos.recordset[0];
        const nuevo = ultimos.recordset[0];
        
        if (viejo && nuevo) {
            console.log('\nCampo'.padEnd(30), 'VIEJO'.padEnd(30), 'NUEVO');
            console.log('-'.repeat(90));
            const allKeys = new Set([...Object.keys(viejo), ...Object.keys(nuevo)]);
            allKeys.forEach(key => {
                const viejoVal = JSON.stringify(viejo[key]);
                const nuevoVal = JSON.stringify(nuevo[key]);
                const diff = viejoVal !== nuevoVal ? ' ⚠️ DIFERENTE' : '';
                console.log(`${key.padEnd(30)} ${String(viejoVal).padEnd(30)} ${nuevoVal}${diff}`);
            });
        }

        // 5. Verificar si hay columnas que el INSERT del sistema nuevo NO está llenando
        console.log('\n========== CAMPOS NULL EN REGISTROS NUEVOS QUE NO SON NULL EN VIEJOS ==========');
        if (viejo && nuevo) {
            Object.keys(viejo).forEach(key => {
                if ((viejo[key] !== null && viejo[key] !== undefined && viejo[key] !== 0 && viejo[key] !== '') && 
                    (nuevo[key] === null || nuevo[key] === undefined || nuevo[key] === 0 || nuevo[key] === '')) {
                    console.log(`  ⚠️ ${key}: VIEJO=${JSON.stringify(viejo[key])}, NUEVO=${JSON.stringify(nuevo[key])}`);
                }
            });
        }

        // 6. Verificar NroIndicacion - ¿Es IDENTITY o manual?
        console.log('\n========== VERIFICAR IDENTITY ==========');
        const identity = await pool.request().query(`
            SELECT COLUMNPROPERTY(OBJECT_ID('imInterIndMedicas'), 'NroIndicacion', 'IsIdentity') AS IsIdentity
        `);
        console.log('NroIndicacion es IDENTITY:', identity.recordset[0]?.IsIdentity);

        // 7. Ver si hay algún campo especial que Clarion usa para filtrar
        console.log('\n========== VERIFICAR ÍNDICES ==========');
        const indices = await pool.request().query(`
            SELECT i.name AS IndexName, ic.index_column_id, c.name AS ColumnName, i.type_desc
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            WHERE i.object_id = OBJECT_ID('imInterIndMedicas')
            ORDER BY i.name, ic.index_column_id
        `);
        indices.recordset.forEach(idx => {
            console.log(`  ${idx.IndexName.padEnd(40)} ${idx.ColumnName.padEnd(25)} ${idx.type_desc}`);
        });

        // 8. Verificar si la tabla tiene triggers
        console.log('\n========== VERIFICAR TRIGGERS ==========');
        const triggers = await pool.request().query(`
            SELECT name, type_desc, is_disabled
            FROM sys.triggers
            WHERE parent_id = OBJECT_ID('imInterIndMedicas')
        `);
        if (triggers.recordset.length === 0) {
            console.log('  No hay triggers en la tabla');
        } else {
            triggers.recordset.forEach(t => {
                console.log(`  ${t.name} - ${t.type_desc} - Disabled: ${t.is_disabled}`);
            });
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

diagnose();
