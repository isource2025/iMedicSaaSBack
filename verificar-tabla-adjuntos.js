const sql = require('mssql');

const config = {
  user: 'sa',
  password: 'isource',
  server: '190.136.234.4',
  database: 'vidal',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  requestTimeout: 30000
};

async function verificarTablaAdjuntos() {
  try {
    console.log('🔍 Conectando a la base de datos...');
    const pool = await sql.connect(config);
    
    console.log('\n📊 Verificando estructura de tabla imPedidosEstudiosAdjuntos...\n');
    
    const result = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE,
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imPedidosEstudiosAdjuntos'
      ORDER BY ORDINAL_POSITION
    `);
    
    if (result.recordset.length === 0) {
      console.log('❌ La tabla imPedidosEstudiosAdjuntos NO EXISTE');
    } else {
      console.log('✅ Tabla encontrada. Estructura:\n');
      console.table(result.recordset);
      
      // Verificar si hay registros
      const count = await pool.request().query(`
        SELECT COUNT(*) as Total FROM imPedidosEstudiosAdjuntos
      `);
      console.log(`\n📈 Total de registros: ${count.recordset[0].Total}`);
      
      // Mostrar algunos registros de ejemplo
      if (count.recordset[0].Total > 0) {
        const sample = await pool.request().query(`
          SELECT TOP 3 * FROM imPedidosEstudiosAdjuntos ORDER BY Fecha DESC
        `);
        console.log('\n📄 Registros de ejemplo:');
        console.table(sample.recordset);
      }
    }
    
    await pool.close();
    console.log('\n✅ Verificación completada');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

verificarTablaAdjuntos();
