/**
 * Script corregido para insertar datos en la tabla imEstadoMilitar
 */
require('dotenv').config();
const sql = require('mssql');

// Configuración de la conexión
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Datos iniciales de Estados Militares con valores de UN solo carácter
const estadosMilitares = [
  { Valor: 'S', Descripcion: 'Servicio Militar Obligatorio' },
  { Valor: 'V', Descripcion: 'Voluntario' },
  { Valor: 'R', Descripcion: 'Reservista' },
  { Valor: 'O', Descripcion: 'Oficial' },
  { Valor: 'B', Descripcion: 'Suboficial' },
  { Valor: 'C', Descripcion: 'Civil' }
];

async function insertEstadosMilitares() {
  try {
    // Conectar a la base de datos
    console.log('Conectando a la base de datos...');
    await sql.connect(sqlConfig);
    console.log('✅ Conexión exitosa');

    // Insertar datos
    console.log('Insertando datos iniciales en imEstadoMilitar...');
    
    for (const estado of estadosMilitares) {
      await sql.query`
        IF NOT EXISTS (SELECT 1 FROM imEstadoMilitar WHERE VALOR = ${estado.Valor})
        BEGIN
          INSERT INTO imEstadoMilitar (VALOR, DESCRIPCION)
          VALUES (${estado.Valor}, ${estado.Descripcion})
        END
        ELSE
        BEGIN
          UPDATE imEstadoMilitar
          SET DESCRIPCION = ${estado.Descripcion}
          WHERE VALOR = ${estado.Valor}
        END
      `;
      console.log(`✅ Insertado/Actualizado: ${estado.Valor} - ${estado.Descripcion}`);
    }

    // Verificar los datos insertados
    const dataResult = await sql.query`SELECT VALOR, DESCRIPCION FROM imEstadoMilitar`;
    
    console.log(`Datos de la tabla imEstadoMilitar (${dataResult.recordset.length} registros):`);
    console.table(dataResult.recordset);

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await sql.close();
  }
}

insertEstadosMilitares();
