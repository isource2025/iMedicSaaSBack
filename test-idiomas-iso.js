const { executeQuery } = require('./src/config/database');

async function testIdiomasISOTable() {
  try {
    // Verificar si la tabla existe
    console.log('Verificando si la tabla imIdiomasISO existe...');
    const checkTableQuery = `
      SELECT CASE 
        WHEN OBJECT_ID('imIdiomasISO', 'U') IS NOT NULL THEN 1 
        ELSE 0 
      END AS table_exists;
    `;
    const tableExists = await executeQuery(checkTableQuery);
    console.log('¿La tabla existe?:', tableExists[0].table_exists === 1 ? 'Sí' : 'No');

    if (tableExists[0].table_exists === 1) {
      // Consultar estructura de la tabla
      console.log('\nConsultando estructura de la tabla imIdiomasISO...');
      const structureQuery = `
        SELECT 
          COLUMN_NAME, 
          DATA_TYPE, 
          CHARACTER_MAXIMUM_LENGTH 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'imIdiomasISO';
      `;
      const structure = await executeQuery(structureQuery);
      console.log('Estructura de la tabla:');
      console.table(structure);

      // Consultar datos en la tabla
      console.log('\nConsultando datos en imIdiomasISO...');
      const dataQuery = 'SELECT Valor, descripcion FROM imIdiomasISO';
      const data = await executeQuery(dataQuery);
      console.log(`Número de registros encontrados: ${data.length}`);
      
      if (data.length > 0) {
        console.log('\nPrimeros 10 registros:');
        console.table(data.slice(0, 10));
      } else {
        console.log('La tabla está vacía.');
      }
    }
  } catch (error) {
    console.error('Error al consultar la tabla:', error);
  }
}

testIdiomasISOTable()
  .then(() => console.log('\nProceso completado'))
  .catch(console.error);
