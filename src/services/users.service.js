const { executeQuery } = require('../models/db');
const { convertirFechaAClarion } = require('../utils/dateUtils');

/** @type {string|null} 'int' | otros — cache por proceso */
let cachedFechaActualTipo = null;

/**
 * imPassword.FechaActual es int (días Clarion) en muchas bases legacy; en otras es datetime.
 */
async function getImPasswordFechaActualTipo() {
  if (cachedFechaActualTipo) return cachedFechaActualTipo;
  try {
    const rows = await executeQuery(`
      SELECT DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE UPPER(TABLE_NAME) = 'IMPASSWORD' AND UPPER(COLUMN_NAME) = 'FECHAACTUAL'
    `);
    const t = (rows[0]?.DATA_TYPE || 'datetime').toLowerCase();
    cachedFechaActualTipo = ['int', 'smallint', 'bigint', 'tinyint'].includes(t) ? 'int' : t;
  } catch {
    cachedFechaActualTipo = 'datetime';
  }
  return cachedFechaActualTipo;
}

/**
 * Obtiene todos los usuarios con sus sectores asignados
 * @returns {Promise<Array>} Lista de usuarios
 */
const obtenerTodosLosUsuarios = async () => {
  try {
    // Consulta optimizada con LEFT JOIN para obtener usuarios y sectores en una sola query
    const consulta = `
      SELECT 
        p.ValorPersonal,
        ISNULL(RTRIM(LTRIM(p.CodOperador)), '') as CodOperador,
        ISNULL(RTRIM(LTRIM(p.Apellido)), '') as Apellido,
        ISNULL(RTRIM(LTRIM(p.Nombres)), '') as Nombres,
        ISNULL(RTRIM(LTRIM(p.NombreRed)), '') as NombreRed,
        ISNULL(RTRIM(LTRIM(p.NumeroDocumento)), '') as NumeroDocumento,
        ISNULL(RTRIM(LTRIM(p.Legajo)), '') as Legajo,
        p.MarcadeBaja,
        p.FechaActual,
        ps.idSector,
        s.Descripcion as descripcionSector
      FROM imPassword p
      LEFT JOIN imPersonalSectores ps ON p.ValorPersonal = ps.idPersonal
      LEFT JOIN imSectores s ON ps.idSector = s.Valor
      ORDER BY p.Apellido, p.Nombres
    `;
    
    const resultado = await executeQuery(consulta);
    
    // Agrupar sectores por usuario
    const usuariosMap = new Map();
    
    resultado.forEach(row => {
      const userId = row.ValorPersonal;
      
      if (!usuariosMap.has(userId)) {
        usuariosMap.set(userId, {
          ValorPersonal: row.ValorPersonal,
          CodOperador: row.CodOperador,
          Apellido: row.Apellido,
          Nombres: row.Nombres,
          NombreRed: row.NombreRed,
          NumeroDocumento: row.NumeroDocumento,
          Legajo: row.Legajo,
          MarcadeBaja: row.MarcadeBaja,
          FechaActual: row.FechaActual,
          sectores: []
        });
      }
      
      // Agregar sector si existe
      if (row.idSector) {
        usuariosMap.get(userId).sectores.push({
          idSector: row.idSector,
          descripcionSector: row.descripcionSector
        });
      }
    });
    
    return Array.from(usuariosMap.values());
  } catch (error) {
    console.error('Error al obtener usuarios:', error.message);
    throw error;
  }
};

/**
 * Obtiene un usuario por su ValorPersonal
 * @param {number} valorPersonal - ID del usuario
 * @returns {Promise<Object>} Datos del usuario
 */
const obtenerUsuarioPorId = async (valorPersonal) => {
  try {
    const consulta = `
      SELECT 
        p.ValorPersonal,
        p.CodOperador,
        p.Apellido,
        p.Nombres,
        p.NombreRed,
        p.Password,
        p.NumeroDocumento,
        p.Legajo,
        p.MarcadeBaja,
        p.FechaActual
      FROM imPassword p
      WHERE p.ValorPersonal = @p0
    `;
    
    const resultado = await executeQuery(consulta, [{ value: valorPersonal }]);
    
    if (resultado && resultado.length > 0) {
      const usuario = resultado[0];
      
      // Obtener sectores del usuario
      const sectoresConsulta = `
        SELECT 
          ps.idSector,
          s.Descripcion as descripcionSector
        FROM imPersonalSectores ps
        INNER JOIN imSectores s ON ps.idSector = s.Valor
        WHERE ps.idPersonal = @p0
      `;
      
      const sectores = await executeQuery(sectoresConsulta, [{ value: valorPersonal }]);
      usuario.sectores = sectores || [];
      
      return usuario;
    }
    
    return null;
  } catch (error) {
    console.error('Error al obtener usuario por ID:', error.message);
    throw error;
  }
};

/**
 * Crea un nuevo usuario
 * @param {Object} userData - Datos del nuevo usuario
 * @returns {Promise<Object>} Usuario creado
 */
const crearUsuario = async (userData) => {
  try {
    const { 
      codOperador, 
      apellido, 
      nombres, 
      nombreRed, 
      password, 
      numeroDocumento, 
      legajo 
    } = userData;
    
    // Obtener el próximo ValorPersonal disponible
    const maxIdQuery = `SELECT MAX(ValorPersonal) as maxId FROM imPassword`;
    const maxIdResult = await executeQuery(maxIdQuery);
    const nuevoValorPersonal = (maxIdResult[0].maxId || 0) + 1;

    const fechaTipo = await getImPasswordFechaActualTipo();
    const hoy = new Date();
    const fechaLocalStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const fechaClarionHoy = convertirFechaAClarion(fechaLocalStr);

    const consulta =
      fechaTipo === 'int'
        ? `
      INSERT INTO imPassword (
        ValorPersonal,
        CodOperador,
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, 0, 0)
    `
        : `
      INSERT INTO imPassword (
        ValorPersonal,
        CodOperador,
        Apellido,
        Nombres,
        NombreRed,
        Password,
        NumeroDocumento,
        Legajo,
        FechaActual,
        MarcadeBaja,
        Grupo
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, GETDATE(), 0, 0)
    `;

    const parametros = [
      { value: nuevoValorPersonal, type: 'Int' },
      { value: codOperador || '', type: 'VarChar' },
      { value: apellido, type: 'VarChar' },
      { value: nombres, type: 'VarChar' },
      { value: nombreRed, type: 'VarChar' },
      { value: password, type: 'VarChar' },
      { value: numeroDocumento || '', type: 'VarChar' },
      { value: legajo || '', type: 'VarChar' }
    ];
    if (fechaTipo === 'int') {
      parametros.push({ value: fechaClarionHoy, type: 'Int' });
    }

    await executeQuery(consulta, parametros);
    
    return await obtenerUsuarioPorId(nuevoValorPersonal);
  } catch (error) {
    console.error('Error al crear usuario:', error.message);
    throw error;
  }
};

/**
 * Actualiza la contraseña de un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {string} nuevaPassword - Nueva contraseña
 * @returns {Promise<boolean>} Resultado de la operación
 */
const cambiarPassword = async (valorPersonal, nuevaPassword) => {
  try {
    const consulta = `
      UPDATE imPassword 
      SET Password = @p1
      WHERE ValorPersonal = @p0
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: nuevaPassword, type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    return true;
  } catch (error) {
    console.error('Error al cambiar contraseña:', error.message);
    throw error;
  }
};

/**
 * Asigna un sector a un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {string} idSector - ID del sector
 * @returns {Promise<boolean>} Resultado de la operación
 */
const asignarSector = async (valorPersonal, idSector) => {
  try {
    // Verificar si ya existe la asignación
    const verificarConsulta = `
      SELECT * FROM imPersonalSectores 
      WHERE idPersonal = @p0 AND idSector = @p1
    `;
    
    const existe = await executeQuery(verificarConsulta, [
      { value: valorPersonal },
      { value: idSector, type: 'VarChar' }
    ]);
    
    if (existe && existe.length > 0) {
      throw new Error('El usuario ya tiene asignado este sector');
    }
    
    const consulta = `
      INSERT INTO imPersonalSectores (idPersonal, idSector)
      VALUES (@p0, @p1)
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: idSector, type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    return true;
  } catch (error) {
    console.error('Error al asignar sector:', error.message);
    throw error;
  }
};

/**
 * Quita un sector de un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {string} idSector - ID del sector
 * @returns {Promise<boolean>} Resultado de la operación
 */
const quitarSector = async (valorPersonal, idSector) => {
  try {
    const consulta = `
      DELETE FROM imPersonalSectores 
      WHERE idPersonal = @p0 AND idSector = @p1
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: idSector, type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    return true;
  } catch (error) {
    console.error('Error al quitar sector:', error.message);
    throw error;
  }
};

/**
 * Actualiza los datos básicos de un usuario
 * @param {number} valorPersonal - ID del usuario
 * @param {Object} userData - Datos a actualizar
 * @returns {Promise<Object>} Usuario actualizado
 */
const actualizarUsuario = async (valorPersonal, userData) => {
  try {
    const { codOperador, apellido, nombres, nombreRed, numeroDocumento, legajo } = userData;
    
    const consulta = `
      UPDATE imPassword 
      SET 
        CodOperador = @p1,
        Apellido = @p2,
        Nombres = @p3,
        NombreRed = @p4,
        NumeroDocumento = @p5,
        Legajo = @p6
      WHERE ValorPersonal = @p0
    `;
    
    const parametros = [
      { value: valorPersonal },
      { value: codOperador || '', type: 'VarChar' },
      { value: apellido, type: 'VarChar' },
      { value: nombres, type: 'VarChar' },
      { value: nombreRed, type: 'VarChar' },
      { value: numeroDocumento || '', type: 'VarChar' },
      { value: legajo || '', type: 'VarChar' }
    ];
    
    await executeQuery(consulta, parametros);
    
    return await obtenerUsuarioPorId(valorPersonal);
  } catch (error) {
    console.error('Error al actualizar usuario:', error.message);
    throw error;
  }
};

module.exports = {
  obtenerTodosLosUsuarios,
  obtenerUsuarioPorId,
  crearUsuario,
  cambiarPassword,
  asignarSector,
  quitarSector,
  actualizarUsuario
};
