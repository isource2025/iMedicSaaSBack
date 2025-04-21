const { executeQuery } = require('../models/db');

const autenticarUsuario = async (username, contraseña) => {
  try {
    // Verificar credenciales contra la tabla impassword
    const consulta = `SELECT * FROM impassword WHERE nombrered = @p0 AND password = @p1`;
    const parametros = [
      { value: username },
      { value: contraseña }
    ];
    
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      return resultado[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error al autenticar usuario:', error.message);
    throw error;
  }
};

/**
 * Obtiene todos los sectores disponibles con sus descripciones
 * @returns {Promise<Array>} Lista de sectores con sus descripciones
 */
const obtenerSectores = async () => {
  try {
    // Realizar JOIN con la tabla imsectores para obtener la descripción
    const consulta = `
      SELECT 
        p.idpersonal as ValorPersonalSector, 
        s.descripcion as DescripcionPersonalSector 
      FROM 
        impersonalsectores p
      INNER JOIN 
        imsectores s ON p.idsector = s.valor
    `;
    
    const resultado = await executeQuery(consulta);
    console.log('Datos obtenidos de sectores con JOIN:', JSON.stringify(resultado, null, 2));
    return resultado;
  } catch (error) {
    console.error('Error al obtener sectores:', error.message);
    throw error;
  }
};

/**
 * Obtiene los sectores disponibles para un usuario específico
 * @param {string} username - Nombre de usuario
 * @returns {Promise<Array>} Lista de sectores filtrados para el usuario
 */
const obtenerSectoresPorUsuario = async (username) => {
  try {
    // Realizar consulta con JOIN para obtener solo los sectores asociados al usuario
    const consulta = `
      SELECT 
        p.idpersonal as ValorPersonalSector,
        p.idsector as ValorSector, 
        s.descripcion as DescripcionPersonalSector 
      FROM 
        impersonalsectores p
      INNER JOIN 
        imsectores s ON p.idsector = s.valor
      INNER JOIN 
        impassword pw ON p.idpersonal = pw.valorpersonal
      WHERE 
        pw.nombrered = @p0
    `;
    
    const parametros = [{ value: username }];
    console.log(`Ejecutando consulta SQL:\n${consulta}\nCon parámetro: ${username}`);
    const resultado = await executeQuery(consulta, parametros);
    console.log(`Sectores filtrados para usuario ${username}:`, JSON.stringify(resultado, null, 2));
    return resultado;
  } catch (error) {
    console.error(`Error al obtener sectores para usuario ${username}:`, error.message);
    throw error;
  }
};

/**
 * Obtiene el idsector y la descripción correspondiente a un idpersonal
 * @param {string} idpersonal - ID del personal
 * @returns {Promise<Object>} Información del sector (idsector y descripción)
 */
const obtenerIdSectorPorIdPersonal = async (idpersonal) => {
  try {
    if (!idpersonal) {
      return null;
    }
    
    const consulta = `
      SELECT 
        p.idsector,
        s.descripcion
      FROM 
        impersonalsectores p
      INNER JOIN 
        imsectores s ON p.idsector = s.valor
      WHERE 
        p.idpersonal = @p0
    `;
    
    const parametros = [{ value: idpersonal }];
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      console.log(`Sector encontrado para idpersonal ${idpersonal}:`, JSON.stringify(resultado[0], null, 2));
      return resultado[0];
    }
    
    console.warn(`No se encontró ningún sector para idpersonal ${idpersonal}`);
    return null;
  } catch (error) {
    console.error(`Error al obtener sector para idpersonal ${idpersonal}:`, error.message);
    throw error;
  }
};

/**
 * Autentica con credenciales temporales (contingencia)
 * @param {string} username - Nombre de usuario
 * @param {string} contraseña - Contraseña del usuario
 * @returns {Promise<boolean>} Resultado de la autenticación
 */
const autenticarConCredencialesTemporales = async (username, contraseña) => {
  // Credenciales temporales para modo de contingencia
  return username === 'admin' && contraseña === 'admin';
};

/**
 * Obtiene la descripción de un sector basado en su idsector
 * @param {string} idsector - ID del sector
 * @returns {Promise<Object>} Objeto con la descripción del sector
 */
const obtenerDescripcionSector = async (idsector) => {
  try {
    if (!idsector) {
      return null;
    }
    
    const consulta = `
      SELECT 
        valor as idsector,
        descripcion
      FROM 
        imsectores
      WHERE 
        valor = @p0
    `;
    
    const parametros = [{ value: idsector }];
    console.log(`Consultando descripción para idsector: ${idsector}`);
    
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      console.log(`Descripción encontrada para idsector ${idsector}:`, JSON.stringify(resultado[0], null, 2));
      return resultado[0];
    }
    
    console.warn(`No se encontró descripción para idsector ${idsector}`);
    return null;
  } catch (error) {
    console.error(`Error al obtener descripción para idsector ${idsector}:`, error.message);
    throw error;
  }
};

module.exports = {
  autenticarUsuario,
  autenticarConCredencialesTemporales,
  obtenerSectores,
  obtenerSectoresPorUsuario,
  obtenerIdSectorPorIdPersonal,
  obtenerDescripcionSector
};
