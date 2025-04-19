/**
 * Controlador para la gestión de pacientes
 */
const patientsService = require('../services/patients.service');

/**
 * Obtiene todos los pacientes
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerPacientes = async (req, res) => {
  try {
    const pacientes = await patientsService.obtenerPacientes();
    res.json({
      success: true,
      data: pacientes
    });
  } catch (error) {
    console.error('Error al obtener pacientes:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los pacientes'
    });
  }
};

/**
 * Busca pacientes por nombre o documento
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const buscarPacientes = async (req, res) => {
  try {
    const { searchTerm } = req.query;
    
    if (!searchTerm || searchTerm.trim() === '') {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere un término de búsqueda'
      });
    }
    
    const pacientes = await patientsService.buscarPacientes(searchTerm);
    res.json({
      success: true,
      data: pacientes
    });
  } catch (error) {
    console.error('Error al buscar pacientes:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al buscar pacientes'
    });
  }
};

/**
 * Obtiene un paciente por su ID
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerPacientePorId = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID inválido'
      });
    }
    
    const paciente = await patientsService.obtenerPacientePorId(id);
    
    if (!paciente) {
      return res.status(404).json({
        success: false,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: paciente
    });
  } catch (error) {
    console.error('Error al obtener paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener el paciente'
    });
  }
};

/**
 * Crea un nuevo paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const crearPaciente = async (req, res) => {
  try {
    const { ApellidoyNombre, Domicilio, Sexo, NumeroHC, FechaNacimiento, EstadoCivil } = req.body;
    
    // Validación básica
    if (!ApellidoyNombre || !Sexo || !NumeroHC) {
      return res.status(400).json({
        success: false,
        mensaje: 'Faltan campos obligatorios (nombre, sexo y número de historia clínica)'
      });
    }
    
    const nuevoPaciente = await patientsService.crearPaciente({
      ApellidoyNombre,
      Domicilio,
      Sexo,
      NumeroHC,
      FechaNacimiento,
      EstadoCivil
    });
    
    res.status(201).json({
      success: true,
      mensaje: 'Paciente creado con éxito',
      data: nuevoPaciente
    });
  } catch (error) {
    console.error('Error al crear paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al crear el paciente'
    });
  }
};

/**
 * Actualiza un paciente existente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const actualizarPaciente = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { ApellidoyNombre, Domicilio, Sexo, NumeroHC, FechaNacimiento, EstadoCivil } = req.body;
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID inválido'
      });
    }
    
    // Validación básica
    if (!ApellidoyNombre || !Sexo || !NumeroHC) {
      return res.status(400).json({
        success: false,
        mensaje: 'Faltan campos obligatorios (nombre, sexo y número de historia clínica)'
      });
    }
    
    const pacienteActualizado = await patientsService.actualizarPaciente(id, {
      ApellidoyNombre,
      Domicilio,
      Sexo,
      NumeroHC,
      FechaNacimiento,
      EstadoCivil
    });
    
    if (!pacienteActualizado) {
      return res.status(404).json({
        success: false,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    res.json({
      success: true,
      mensaje: 'Paciente actualizado con éxito',
      data: pacienteActualizado
    });
  } catch (error) {
    console.error('Error al actualizar paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar el paciente'
    });
  }
};

/**
 * Elimina un paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const eliminarPaciente = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID inválido'
      });
    }
    
    const eliminado = await patientsService.eliminarPaciente(id);
    
    if (!eliminado) {
      return res.status(404).json({
        success: false,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    res.json({
      success: true,
      mensaje: 'Paciente eliminado con éxito'
    });
  } catch (error) {
    console.error('Error al eliminar paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al eliminar el paciente'
    });
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
