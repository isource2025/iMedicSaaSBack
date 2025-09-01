const { executeQuery } = require('./src/config/database');

async function createIdiomasISOTable() {
  try {
    console.log('Verificando si la tabla imIdiomasISO existe...');
    const checkTableQuery = `
      SELECT CASE 
        WHEN OBJECT_ID('imIdiomasISO', 'U') IS NOT NULL THEN 1 
        ELSE 0 
      END AS table_exists;
    `;
    const tableExists = await executeQuery(checkTableQuery);
    
    if (tableExists[0].table_exists === 1) {
      console.log('La tabla imIdiomasISO ya existe.');
    } else {
      console.log('Creando tabla imIdiomasISO...');
      const createTableQuery = `
        CREATE TABLE imIdiomasISO (
          Valor char(3) PRIMARY KEY,
          descripcion varchar(40) NOT NULL
        );
      `;
      await executeQuery(createTableQuery);
      console.log('Tabla imIdiomasISO creada exitosamente.');
      
      // Insertar datos iniciales
      console.log('Insertando datos iniciales...');
      const insertData = [
        { valor: 'ESP', descripcion: 'Español' },
        { valor: 'ENG', descripcion: 'Inglés' },
        { valor: 'POR', descripcion: 'Portugués' },
        { valor: 'FRA', descripcion: 'Francés' },
        { valor: 'ITA', descripcion: 'Italiano' },
        { valor: 'DEU', descripcion: 'Alemán' },
        { valor: 'ZHO', descripcion: 'Chino' },
        { valor: 'JPN', descripcion: 'Japonés' },
        { valor: 'RUS', descripcion: 'Ruso' },
        { valor: 'ARA', descripcion: 'Árabe' }
      ];
      
      for (const item of insertData) {
        const insertQuery = `
          INSERT INTO imIdiomasISO (Valor, descripcion)
          VALUES ('${item.valor}', '${item.descripcion}');
        `;
        await executeQuery(insertQuery);
      }
      
      console.log('Datos iniciales insertados correctamente.');
    }
    
    // Verificar datos en la tabla
    console.log('\nVerificando datos en imIdiomasISO...');
    const dataQuery = 'SELECT Valor, descripcion FROM imIdiomasISO';
    const data = await executeQuery(dataQuery);
    console.log(`Número de registros encontrados: ${data.length}`);
    
    if (data.length > 0) {
      console.log('\nRegistros en la tabla:');
      console.table(data);
    } else {
      console.log('La tabla está vacía.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

createIdiomasISOTable()
  .then(() => console.log('\nProceso completado'))
  .catch(console.error);
