/**
 * Modelo para realizar operaciones con SQL Server
 * @module models/db
 */
const { sql, connectDB } = require('../config/database');
const { getTenantPool } = require('../config/tenantDb');
const { getTenantId } = require('../context/tenantContext');

async function resolvePool(forcePlatform = false) {
  if (forcePlatform) return connectDB();
  const idEmpresa = getTenantId();
  if (idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0) {
    return getTenantPool(idEmpresa);
  }
  return connectDB();
}

/**
 * Ejecuta una consulta SQL y devuelve los resultados
 * @param {string} consulta - Consulta SQL a ejecutar
 * @param {Array} parametros - Array de parámetros
 * @param {{ platform?: boolean }} [opts] - platform: true fuerza BD catálogo (.env)
 * @returns {Promise<Array>} Resultados de la consulta
 */
async function executeQuery(consulta, parametros = [], opts = {}) {
  try {
    const pool = await resolvePool(!!opts.platform);
    const request = pool.request();
    
    console.log('Ejecutando consulta SQL:', consulta);
    
    // Añadir parámetros si existen
    if (parametros && parametros.length > 0) {
      parametros.forEach((parametro, indice) => {
        const nombreParametro = `param${indice}`;
        console.log(`Añadiendo parámetro ${nombreParametro}:`, parametro.value, `Tipo: ${parametro.type || 'auto'}`);
        
        // Si se especifica un tipo, usarlo; si no, dejar que SQL Server lo infiera
        if (parametro.type) {
          request.input(nombreParametro, sql[parametro.type], parametro.value);
        } else {
          request.input(nombreParametro, parametro.value);
        }
        
        const regex = new RegExp(`@p${indice}\\b`, 'g');
        consulta = consulta.replace(regex, `@${nombreParametro}`);
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
/** Siempre contra la BD plataforma (catálogo Empresas, Super Admin). */
async function executePlatformQuery(consulta, parametros = []) {
  return executeQuery(consulta, parametros, { platform: true });
}

async function executeProcedure(nombreProcedimiento, parametros = {}, opts = {}) {
  try {
    const pool = await resolvePool(!!opts.platform);
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
  executePlatformQuery,
  executeProcedure,
  sql
};
