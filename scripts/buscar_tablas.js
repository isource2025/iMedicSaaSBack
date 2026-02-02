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

async function buscarTablas() {
    try {
        console.log('Conectando a la base de datos...');
        await sql.connect(config);
        console.log('✅ Conectado\n');

        // Buscar todas las tablas que contengan "vadem" en el nombre
        console.log('Buscando tablas con "vadem" en el nombre...\n');
        const tablas = await sql.query`
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME LIKE '%vadem%'
            ORDER BY TABLE_NAME
        `;
        
        if (tablas.recordset.length > 0) {
            console.log('Tablas encontradas:');
            console.table(tablas.recordset);
        } else {
            console.log('No se encontraron tablas con "vadem" en el nombre');
        }

        // Buscar todas las tablas que empiecen con "im"
        console.log('\nBuscando todas las tablas que empiezan con "im"...\n');
        const tablasIm = await sql.query`
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME LIKE 'im%'
            ORDER BY TABLE_NAME
        `;
        
        console.log(`Encontradas ${tablasIm.recordset.length} tablas:`);
        console.table(tablasIm.recordset);

        await sql.close();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

buscarTablas();
