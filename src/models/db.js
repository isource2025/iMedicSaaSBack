/**
 * Modelo para realizar operaciones con SQL Server
 * @module models/db
 */
const { sql, connectDB } = require('../config/database');

/**
 * Ejecuta una consulta SQL y devuelve los resultados
 * @param {string} consulta - Consulta SQL a ejecutar
 * @param {Array} parametros - Array de parámetros
 * @returns {Promise<Array>} Resultados de la consulta
 */
async function executeQuery(consulta, parametros = []) {
  try {
    // Asegurar que la conexión está activa
    const pool = await connectDB();
    const request = pool.request();
    
    console.log('Ejecutando consulta SQL:', consulta);
    
    // Añadir parámetros si existen
    if (parametros && parametros.length > 0) {
      parametros.forEach((parametro, indice) => {
        const nombreParametro = `param${indice}`;
        console.log(`Añadiendo parámetro ${nombreParametro}:`, parametro.value);
        request.input(nombreParametro, parametro.value);
        consulta = consulta.replaceAll(`@p${indice}`, `@${nombreParametro}`);
      });
    }
    
    console.log('Consulta final:', consulta);
    const resultado = await request.query(consulta);
    console.log('Resultado consulta:', resultado.recordset ? `${resultado.recordset.length} registros encontrados` : 'Sin registros');
    return resultado.recordset;
  } catch (error) {
    console.error('Error al ejecutar consulta SQL:', error.message);
    console.error('Detalles del error:', JSON.stringify(error, null, 2));
    throw error;
  }
}

/**
 * Ejecuta un procedimiento almacenado y devuelve los resultados
 * @param {string} nombreProcedimiento - Nombre del procedimiento almacenado
 * @param {Object} parametros - Objeto con parámetros
 * @returns {Promise<Object>} Resultados del procedimiento
 */
async function executeProcedure(nombreProcedimiento, parametros = {}) {
  try {
    // Asegurar que la conexión está activa
    const pool = await connectDB();
    const request = pool.request();
    
    // Añadir parámetros si existen
    if (parametros && Object.keys(parametros).length > 0) {
      for (const [clave, valor] of Object.entries(parametros)) {
        if (typeof valor === 'object' && valor !== null) {
          request.input(clave, valor.type, valor.value);
        } else {
          request.input(clave, valor);
        }
      }
    }
    
    const resultado = await request.execute(nombreProcedimiento);
    return resultado;
  } catch (error) {
    console.error(`Error al ejecutar procedimiento ${nombreProcedimiento}:`, error);
    throw error;
  }
}

module.exports = {
  executeQuery,
  executeProcedure,
  sql
};
