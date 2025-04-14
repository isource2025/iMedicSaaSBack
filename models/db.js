// Modelo para realizar operaciones con SQL Server
const { sql } = require('../config/db');

// Ejecuta una consulta SQL y devuelve los resultados
async function executeQuery(query, params = []) {
  try {
    const request = new sql.Request();
    
    console.log('Ejecutando consulta SQL:', query);
    
    // Añadir parámetros si existen
    if (params && params.length > 0) {
      params.forEach((param, index) => {
        const paramName = `param${index}`;
        console.log(`Añadiendo parámetro ${paramName}:`, param.value);
        request.input(paramName, param.value);
        query = query.replace(`@p${index}`, `@${paramName}`);
      });
    }
    
    console.log('Consulta final:', query);
    const result = await request.query(query);
    console.log('Resultado consulta:', result.recordset ? `${result.recordset.length} registros encontrados` : 'Sin registros');
    return result.recordset;
  } catch (error) {
    console.error('Error al ejecutar consulta SQL:', error.message);
    console.error('Detalles del error:', JSON.stringify(error, null, 2));
    throw error;
  }
}

// Ejecuta un procedimiento almacenado y devuelve los resultados
async function executeProcedure(procedureName, params = {}) {
  try {
    const request = new sql.Request();
    
    // Añadir parámetros si existen
    if (params && Object.keys(params).length > 0) {
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'object' && value !== null) {
          request.input(key, value.type, value.value);
        } else {
          request.input(key, value);
        }
      }
    }
    
    const result = await request.execute(procedureName);
    return result;
  } catch (error) {
    console.error(`Error al ejecutar procedimiento ${procedureName}:`, error);
    throw error;
  }
}

module.exports = {
  executeQuery,
  executeProcedure
};
