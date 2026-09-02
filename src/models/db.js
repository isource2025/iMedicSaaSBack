/**
 * Modelo para realizar operaciones con SQL Server
 * @module models/db
 */
const { sql, connectDB } = require('../config/database');
const { getTenantPool } = require('../config/tenantDb');
const { getTenantId } = require('../context/tenantContext');
const { isAuthCentralEnabled } = require('../config/authCentralDb');
const { repararStringsDeep } = require('../utils/clarionText');

async function resolvePool(forcePlatform = false) {
  if (forcePlatform) return connectDB();
  const idEmpresa = getTenantId();
  if (idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0) {
    return getTenantPool(idEmpresa);
  }
  if (isAuthCentralEnabled()) {
    const err = new Error('Se requiere empresa activa (idEmpresa) para acceder a datos clínicos');
    err.code = 'TENANT_EMPRESA_REQUIRED';
    err.statusCode = 400;
    throw err;
  }
  // Render legacy / sin idEmpresa en JWT → BD plataforma (.env DB_*)
  return connectDB();
}

/** Pool SQL del tenant actual (o plataforma en modo legacy). */
async function getRequestPool(opts = {}) {
  return resolvePool(!!opts.platform);
}

const LENGTH_TYPES = new Set(['VarChar', 'NVarChar', 'Char', 'NChar', 'Binary', 'VarBinary']);
const FIXED_LENGTH_TYPES = new Set(['Char', 'NChar', 'Binary']);

function isEmptySqlValue(v) {
  return v == null || v === '' || (typeof v === 'string' && v.trim() === '');
}

/** sql.VarChar sin longitud en node-mssql queda en VARCHAR(1) y trunca/rompe inserts.
 *  CHAR/NCHAR vacío con length 0 dispara TDS 0xAF (invalid data length). */
function resolveMssqlType(parametro) {
  const typeName = parametro && parametro.type;
  if (!typeName) return undefined;
  if (typeof typeName !== 'string') return typeName;
  const t = sql[typeName];
  if (t == null) return undefined;
  if (LENGTH_TYPES.has(typeName) && typeof t === 'function') {
    if (FIXED_LENGTH_TYPES.has(typeName) && isEmptySqlValue(parametro.value)) {
      return sql.NVarChar(1);
    }
    const n = Number(parametro.length);
    if (Number.isFinite(n) && n > 0) return t(n);
    if (FIXED_LENGTH_TYPES.has(typeName)) return t(1);
    return t(sql.MAX);
  }
  if ((typeName === 'Decimal' || typeName === 'Numeric') && typeof t === 'function') {
    return t(Number(parametro.precision) || 18, parametro.scale != null ? Number(parametro.scale) : 2);
  }
  return t;
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

    if (process.env.NODE_ENV === 'development') {
      console.log('Ejecutando consulta SQL:', consulta);
    }
    
    // Añadir parámetros si existen
    if (parametros && parametros.length > 0) {
      parametros.forEach((parametro, indice) => {
        const nombreParametro = `param${indice}`;
        if (process.env.NODE_ENV === 'development') {
          console.log(`Añadiendo parámetro ${nombreParametro}:`, parametro.value, `Tipo: ${parametro.type || 'auto'}`);
        }

        // Si se especifica un tipo, usarlo; si no, dejar que SQL Server lo infiera
        if (parametro.type) {
          const typeName = typeof parametro.type === 'string' ? parametro.type : '';
          const emptyFixed = FIXED_LENGTH_TYPES.has(typeName) && isEmptySqlValue(parametro.value);
          request.input(
            nombreParametro,
            resolveMssqlType(parametro),
            emptyFixed ? null : parametro.value,
          );
        } else {
          request.input(nombreParametro, parametro.value === '' ? null : parametro.value);
        }
        
        const regex = new RegExp(`@p${indice}\\b`, 'g');
        consulta = consulta.replace(regex, `@${nombreParametro}`);
      });
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Consulta final:', consulta);
    }
    const resultado = await request.query(consulta);
    if (process.env.NODE_ENV === 'development') {
      console.log('Resultado consulta:', resultado.recordset ? `${resultado.recordset.length} registros encontrados` : 'Sin registros');
    }
    const rows = resultado.recordset;
    if (!Array.isArray(rows)) return rows;
    return repararStringsDeep(rows);
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
  getRequestPool,
  sql
};
