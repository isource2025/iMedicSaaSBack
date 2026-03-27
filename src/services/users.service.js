const { executeQuery } = require('../models/db');

/**
 * Obtiene todos los usuarios con sus sectores asignados
 * @returns {Promise<Array>} Lista de usuarios
 */
const obtenerTodosLosUsuarios = async () => {
  try {
    const consulta = `
      SELECT 
        p.ValorPersonal,
        p.CodOperador,
        p.Apellido,
        p.Nombres,
        p.NombreRed,
        p.NumeroDocumento,
        p.Legajo,
        p.MarcadeBaja,
        p.FechaActual
      FROM imPassword p
      ORDER BY p.Apellido, p.Nombres
    `;
    
    const usuarios = await executeQuery(consulta);
    
    // Para cada usuario, obtener sus sectores
    for (let usuario of usuarios) {
      const sectoresConsulta = `
        SELECT 
          ps.idSector,
          s.Descripcion as descripcionSector
        FROM imPersonalSectores ps
        INNER JOIN imSectores s ON ps.idSector = s.Valor
        WHERE ps.idPersonal = @p0
      `;
      
      const sectores = await executeQuery(sectoresConsulta, [{ value: usuario.ValorPersonal }]);
      usuario.sectores = sectores || [];
    }
    
    return usuarios;
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
    
    const consulta = `
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
        MarcadeBaja
      )
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, GETDATE(), 0)
    `;
    
    const parametros = [
      { value: nuevoValorPersonal },
      { value: codOperador || '', type: 'VarChar' },
      { value: apellido, type: 'VarChar' },
      { value: nombres, type: 'VarChar' },
      { value: nombreRed, type: 'VarChar' },
      { value: password, type: 'VarChar' },
      { value: numeroDocumento || '', type: 'VarChar' },
      { value: legajo || '', type: 'VarChar' }
    ];
    
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
