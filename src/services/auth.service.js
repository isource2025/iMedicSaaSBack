const { executeQuery } = require('../models/db');

const esErrorEsquemaRoles = (error) => {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes("invalid object name 'imroles'") ||
    msg.includes("invalid column name 'rol'") ||
    msg.includes("invalid object name 'impersonal'")
  );
};

const autenticarUsuario = async (username, contraseña) => {
  try {
    // Verificar credenciales contra impassword e incluir el rol del usuario
    // resolviendo desde imPersonal.Rol (varchar(20) con el IdRol como string).
    // imPassword.Grupo = 11 sigue siendo "admin" como fallback histórico.
    const consulta = `
      SELECT TOP 1
        pw.*,
        p.Matricula  AS Matricula,
        r.IdRol      AS RolId,
        r.Nombre     AS RolNombre,
        r.Nivel      AS RolNivel
      FROM impassword pw
      LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
      LEFT JOIN imRoles r    ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol))
                              AND r.Activo = 1
      WHERE UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@p0)))
        AND pw.password = @p1
    `;
    const parametros = [
      { value: username, type: 'VarChar' },
      { value: contraseña, type: 'VarChar' }
    ];

    let resultado;
    try {
      resultado = await executeQuery(consulta, parametros);
    } catch (errorConsultaRoles) {
      // Compatibilidad con entornos que aun no tienen imRoles/imPersonal.Rol.
      if (!esErrorEsquemaRoles(errorConsultaRoles)) throw errorConsultaRoles;

      const consultaLegacy = `
        SELECT TOP 1
          pw.*,
          CAST(NULL AS INT)           AS Matricula,
          CAST(NULL AS INT)           AS RolId,
          CAST(NULL AS VARCHAR(50))   AS RolNombre,
          CAST(NULL AS INT)           AS RolNivel
        FROM impassword pw
        WHERE UPPER(RTRIM(LTRIM(pw.nombrered))) = UPPER(RTRIM(LTRIM(@p0)))
          AND pw.password = @p1
      `;
      resultado = await executeQuery(consultaLegacy, parametros);
    }

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
    // Realizar JOIN con la tabla imSectores para obtener la descripción
    const consulta = `
      SELECT 
        s.Valor as idSector, 
        s.Descripcion as descripcionSector 
      FROM 
        imSectores s
    `;
    
    const resultado = await executeQuery(consulta);
    console.log('Datos obtenidos de sectores:', JSON.stringify(resultado, null, 2));
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
    // Usar UPPER y RTRIM para hacer la comparación case-insensitive y sin espacios
    const consulta = `
      SELECT 
        ps.idPersonal as idPersonal,
        ps.idSector as idSector, 
        s.Descripcion as descripcionSector 
      FROM 
        impassword pw
      INNER JOIN 
        imPersonalSectores ps ON pw.ValorPersonal = ps.idPersonal
      INNER JOIN 
        imSectores s ON ps.idSector = s.Valor
      WHERE 
        UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@p0)))
    `;
    
    const parametros = [{ 
      value: username,
      type: 'VarChar' // Especificar tipo VARCHAR para manejar números como strings
    }];
    console.log(`Ejecutando consulta SQL:\n${consulta}\nCon parámetro: ${username}`);
    const resultado = await executeQuery(consulta, parametros);
    console.log(`✅ Resultado CRUDO de la consulta:`, resultado);
    console.log(`✅ Tipo de resultado:`, typeof resultado, Array.isArray(resultado));
    console.log(`✅ Cantidad de registros:`, resultado ? resultado.length : 0);
    console.log(`Sectores filtrados para usuario ${username}:`, JSON.stringify(resultado, null, 2));
    return resultado;
  } catch (error) {
    console.error(`Error al obtener sectores para usuario ${username}:`, error.message);
    throw error;
  }
};

/**
 * Obtiene el idSector y la descripción correspondiente a un idPersonal
 * @param {string} idPersonal - ID del personal
 * @returns {Promise<Object>} Información del sector (idSector y descripción)
 */
const obtenerIdSectorPorIdPersonal = async (idPersonal) => {
  try {
    if (!idPersonal) {
      return null;
    }
    
    const consulta = `
      SELECT 
        ps.idSector,
        s.Descripcion as descripcion
      FROM 
        imPersonalSectores ps
      INNER JOIN 
        imSectores s ON ps.idSector = s.Valor
      WHERE 
        ps.idPersonal = @p0
    `;
    
    const parametros = [{ value: idPersonal }];
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      console.log(`Sector encontrado para idPersonal ${idPersonal}:`, JSON.stringify(resultado[0], null, 2));
      return resultado[0];
    }
    
    console.warn(`No se encontró ningún sector para idPersonal ${idPersonal}`);
    return null;
  } catch (error) {
    console.error(`Error al obtener sector para idPersonal ${idPersonal}:`, error.message);
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
 * Obtiene la descripción de un sector basado en su idSector
 * @param {string} idSector - ID del sector
 * @returns {Promise<Object>} Objeto con la descripción del sector
 */
const obtenerDescripcionSector = async (idSector) => {
  try {
    if (!idSector) {
      return null;
    }
    
    const consulta = `
      SELECT 
        Valor as idSector,
        Descripcion as descripcion
      FROM 
        imSectores
      WHERE 
        Valor = @p0
    `;
    
    const parametros = [{ value: idSector }];
    console.log(`Consultando descripción para idSector: ${idSector}`);
    
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      console.log(`Descripción encontrada para idSector ${idSector}:`, JSON.stringify(resultado[0], null, 2));
      return resultado[0];
    }
    
    console.warn(`No se encontró descripción para idSector ${idSector}`);
    return null;
  } catch (error) {
    console.error(`Error al obtener descripción para idSector ${idSector}:`, error.message);
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
