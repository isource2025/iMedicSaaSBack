/**
 * Script para insertar datos iniciales en la tabla imEstadoMilitar
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

// Datos iniciales de Estados Militares
const estadosMilitares = [
  { Valor: 'SMO', Descripcion: 'Servicio Militar Obligatorio' },
  { Valor: 'VOL', Descripcion: 'Voluntario' },
  { Valor: 'RES', Descripcion: 'Reservista' },
  { Valor: 'OFI', Descripcion: 'Oficial' },
  { Valor: 'SUB', Descripcion: 'Suboficial' },
  { Valor: 'CIV', Descripcion: 'Civil' }
];

async function seedEstadosMilitares() {
  try {
    // Conectar a la base de datos
    console.log('Conectando a la base de datos...');
    await sql.connect(sqlConfig);
    console.log('✅ Conexión exitosa');

    // Verificar si ya existen datos en la tabla
    const checkResult = await sql.query`SELECT COUNT(*) as count FROM imEstadoMilitar`;
    const count = checkResult.recordset[0].count;
    
    if (count > 0) {
      console.log(`⚠️ La tabla ya contiene ${count} registros. ¿Desea continuar? (Ejecute con argumento --force para sobreescribir)`);
      if (!process.argv.includes('--force')) {
        console.log('❌ Operación cancelada. Ejecute con --force para insertar de todos modos.');
        return;
      }
    }

    // Insertar datos
    console.log('Insertando datos iniciales en imEstadoMilitar...');
    
    for (const estado of estadosMilitares) {
      await sql.query`
        IF NOT EXISTS (SELECT 1 FROM imEstadoMilitar WHERE Valor = ${estado.Valor})
        BEGIN
          INSERT INTO imEstadoMilitar (Valor, Descripcion)
          VALUES (${estado.Valor}, ${estado.Descripcion})
        END
        ELSE
        BEGIN
          UPDATE imEstadoMilitar
          SET Descripcion = ${estado.Descripcion}
          WHERE Valor = ${estado.Valor}
        END
      `;
      console.log(`✅ Insertado/Actualizado: ${estado.Valor} - ${estado.Descripcion}`);
    }

    console.log('✅ Datos insertados correctamente');

    // Verificar los datos insertados
    const dataResult = await sql.query`
      SELECT Valor, Descripcion FROM imEstadoMilitar
    `;
    
    console.log(`Datos de la tabla imEstadoMilitar (${dataResult.recordset.length} registros):`);
    console.table(dataResult.recordset);

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await sql.close();
  }
}

seedEstadosMilitares();
