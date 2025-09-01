const { executeQuery } = require('./src/config/database');

async function testGrupoEtnicoTable() {
  try {
    // Consulta simple para obtener los datos
    const sql = `SELECT Valor, descripcion FROM imGrupoEtnico`;
    const result = await executeQuery(sql);
    
    console.log('Número de registros encontrados:', result.length);
    console.log('Datos en formato raw:');
    console.log(result);
    
    // Verificar estructura de los datos
    if (result.length > 0) {
      console.log('\nEstructura del primer registro:');
      console.log(Object.keys(result[0]));
      
      // Mostrar los registros en formato legible
      console.log('\nRegistros en formato legible:');
      result.forEach(item => {
        console.log(`Valor: "${item.Valor}", Descripcion: "${item.descripcion}"`);
      });
    }
  } catch (error) {
    console.error('Error al consultar la tabla:', error);
  }
}

testGrupoEtnicoTable().catch(console.error);
