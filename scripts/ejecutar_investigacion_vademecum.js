const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
    },
    port: parseInt(process.env.DB_PORT || '1433'),
};

async function investigarVademecum() {
    try {
        console.log('Conectando a la base de datos...');
        await sql.connect(config);
        console.log('✅ Conectado\n');

        // 1. Ver columnas de la tabla
        console.log('='.repeat(80));
        console.log('1. ESTRUCTURA DE LA TABLA imVademecum');
        console.log('='.repeat(80));
        const estructura = await sql.query`
            SELECT TOP 1 * FROM dbo.imVademecum
        `;
        console.log('Columnas disponibles:', Object.keys(estructura.recordset[0]));
        console.log('\nPrimer registro completo:');
        console.log(JSON.stringify(estructura.recordset[0], null, 2));

        // 2. Valores únicos de TipoMedicamento
        console.log('\n' + '='.repeat(80));
        console.log('2. VALORES ÚNICOS DE TipoMedicamento');
        console.log('='.repeat(80));
        const tipos = await sql.query`
            SELECT TipoMedicamento, COUNT(*) as Cantidad
            FROM dbo.imVademecum
            GROUP BY TipoMedicamento
            ORDER BY Cantidad DESC
        `;
        console.table(tipos.recordset);

        // 3. Medicamentos específicos que estamos analizando
        console.log('\n' + '='.repeat(80));
        console.log('3. MEDICAMENTOS ESPECÍFICOS (ABBOCATT, ALCOHOL GEL, DEXTROSA)');
        console.log('='.repeat(80));
        const especificos = await sql.query`
            SELECT 
                Troquel,
                Alias,
                Descripcion,
                TipoMedicamento
            FROM dbo.imVademecum
            WHERE Troquel IN (1031, 12000005, 9956856)
            ORDER BY Troquel
        `;
        console.table(especificos.recordset);

        // 4. Ejemplos de medicamentos con TipoMedicamento = 'DESC'
        console.log('\n' + '='.repeat(80));
        console.log('4. EJEMPLOS DE MEDICAMENTOS CON TipoMedicamento = DESC');
        console.log('='.repeat(80));
        const descartables = await sql.query`
            SELECT TOP 10
                Troquel,
                Alias,
                Descripcion,
                TipoMedicamento
            FROM dbo.imVademecum
            WHERE TipoMedicamento = 'DESC'
            ORDER BY Alias
        `;
        console.table(descartables.recordset);

        // 5. Buscar patrones en nombres de descartables típicos
        console.log('\n' + '='.repeat(80));
        console.log('5. MEDICAMENTOS CON NOMBRES TÍPICOS DE DESCARTABLES');
        console.log('='.repeat(80));
        const patrones = await sql.query`
            SELECT TOP 20
                Troquel,
                Alias,
                Descripcion,
                TipoMedicamento
            FROM dbo.imVademecum
            WHERE Alias LIKE '%ABBOCATT%' 
               OR Alias LIKE '%CATETER%' 
               OR Alias LIKE '%AGUJA%' 
               OR Alias LIKE '%JERINGA%'
               OR Alias LIKE '%SONDA%'
               OR Alias LIKE '%GUANTE%'
            ORDER BY Alias
        `;
        console.table(patrones.recordset);

        // 6. Ver si hay otros campos relevantes en el primer registro
        console.log('\n' + '='.repeat(80));
        console.log('6. REGISTRO COMPLETO DE ABBOCATT Nº14 (Troquel 1031)');
        console.log('='.repeat(80));
        const abbocatt = await sql.query`
            SELECT * FROM dbo.imVademecum WHERE Troquel = 1031
        `;
        if (abbocatt.recordset.length > 0) {
            console.log(JSON.stringify(abbocatt.recordset[0], null, 2));
        }

        // 7. Ver registro completo de DEXTROSA
        console.log('\n' + '='.repeat(80));
        console.log('7. REGISTRO COMPLETO DE DEXTROSA (Troquel 9956856)');
        console.log('='.repeat(80));
        const dextrosa = await sql.query`
            SELECT * FROM dbo.imVademecum WHERE Troquel = 9956856
        `;
        if (dextrosa.recordset.length > 0) {
            console.log(JSON.stringify(dextrosa.recordset[0], null, 2));
        }

        console.log('\n✅ Investigación completada');
        await sql.close();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

investigarVademecum();
