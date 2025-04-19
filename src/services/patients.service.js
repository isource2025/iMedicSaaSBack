/**
 * Servicio para gestión de pacientes
 */
const { executeQuery } = require('../models/db');

/**
 * Obtiene todos los pacientes de la tabla impacientes
 * @returns {Promise<Array>} Promise con la lista de pacientes
 */
const obtenerPacientes = async () => {
  try {
    const query = `
      SELECT 
        IDPaciente,
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil
      FROM impacientes
      ORDER BY ApellidoyNombre
    `;
    
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error al obtener pacientes de la base de datos:', error);
    throw error;
  }
};

/**
 * Busca pacientes por nombre o número de documento
 * @param {string} searchTerm - Término de búsqueda (nombre o número de documento)
 * @returns {Promise<Array>} Promise con la lista de pacientes
 */
const buscarPacientes = async (searchTerm) => {
  try {
    const query = `
      SELECT 
        IDPaciente,
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil
      FROM impacientes
      WHERE ApellidoyNombre LIKE @p0
      ORDER BY ApellidoyNombre
    `;
    
    const parametros = [{ value: `%${searchTerm}%` }];
    const result = await executeQuery(query, parametros);
    return result;
  } catch (error) {
    console.error('Error al buscar pacientes:', error);
    throw error;
  }
};

/**
 * Obtiene un paciente por su ID
 * @param {number} id - ID del paciente
 * @returns {Promise<Object|null>} Promise con el paciente encontrado o null si no existe
 */
const obtenerPacientePorId = async (id) => {
  try {
    const query = `
      SELECT 
        IDPaciente,
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil
      FROM impacientes
      WHERE IDPaciente = @p0
    `;
    
    const parametros = [{ value: id }];
    const result = await executeQuery(query, parametros);
    
    if (result.length === 0) {
      return null;
    }
    
    return result[0];
  } catch (error) {
    console.error(`Error al obtener paciente con ID ${id}:`, error);
    throw error;
  }
};

/**
 * Crea un nuevo paciente
 * @param {Object} pacienteData - Datos del paciente
 * @returns {Promise<Object>} Promise con el paciente creado
 */
const crearPaciente = async (pacienteData) => {
  try {
    const query = `
      INSERT INTO impacientes (
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil
      ) 
      VALUES (
        @p0, @p1, @p2, @p3, @p4, @p5
      );
      
      SELECT 
        IDPaciente,
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil
      FROM impacientes
      WHERE IDPaciente = SCOPE_IDENTITY();
    `;
    
    const parametros = [
      { value: pacienteData.ApellidoyNombre },
      { value: pacienteData.Domicilio },
      { value: pacienteData.Sexo },
      { value: pacienteData.NumeroHC },
      { value: pacienteData.FechaNacimiento },
      { value: pacienteData.EstadoCivil }
    ];
    
    const result = await executeQuery(query, parametros);
    return result[0];
  } catch (error) {
    console.error('Error al crear paciente:', error);
    throw error;
  }
};

/**
 * Actualiza un paciente existente
 * @param {number} id - ID del paciente
 * @param {Object} pacienteData - Datos actualizados del paciente
 * @returns {Promise<Object|null>} Promise con el paciente actualizado o null si no existe
 */
const actualizarPaciente = async (id, pacienteData) => {
  try {
    // Primero verificamos si el paciente existe
    const pacienteExistente = await obtenerPacientePorId(id);
    
    if (!pacienteExistente) {
      return null;
    }
    
    const query = `
      UPDATE impacientes
      SET 
        ApellidoyNombre = @p1,
        Domicilio = @p2,
        Sexo = @p3,
        NumeroHC = @p4,
        FechaNacimiento = @p5,
        EstadoCivil = @p6
      WHERE IDPaciente = @p0;
      
      SELECT 
        IDPaciente,
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil
      FROM impacientes
      WHERE IDPaciente = @p0;
    `;
    
    const parametros = [
      { value: id },
      { value: pacienteData.ApellidoyNombre },
      { value: pacienteData.Domicilio },
      { value: pacienteData.Sexo },
      { value: pacienteData.NumeroHC },
      { value: pacienteData.FechaNacimiento },
      { value: pacienteData.EstadoCivil }
    ];
    
    const result = await executeQuery(query, parametros);
    return result[0];
  } catch (error) {
    console.error(`Error al actualizar paciente con ID ${id}:`, error);
    throw error;
  }
};

/**
 * Elimina un paciente
 * @param {number} id - ID del paciente
 * @returns {Promise<boolean>} Promise con true si se eliminó o false si no existe
 */
const eliminarPaciente = async (id) => {
  try {
    // Primero verificamos si el paciente existe
    const pacienteExistente = await obtenerPacientePorId(id);
    
    if (!pacienteExistente) {
      return false;
    }
    
    const query = `
      DELETE FROM impacientes
      WHERE IDPaciente = @p0
    `;
    
    const parametros = [{ value: id }];
    await executeQuery(query, parametros);
    
    return true;
  } catch (error) {
    console.error(`Error al eliminar paciente con ID ${id}:`, error);
    throw error;
  }
};

module.exports = {
  obtenerPacientes,
  buscarPacientes,
  obtenerPacientePorId,
  crearPaciente,
  actualizarPaciente,
  eliminarPaciente
};
