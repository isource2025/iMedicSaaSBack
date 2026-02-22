const hciService = require('../services/hci.service');

/**
 * Controlador para Historia Clínica de Ingreso
 */

/**
 * Obtiene HC por número de visita
 */
exports.getByNumeroVisita = async (req, res) => {
  try {
    const { numeroVisita } = req.params;
    
    if (!numeroVisita) {
      return res.status(400).json({
        success: false,
        mensaje: 'Número de visita es requerido'
      });
    }
    
    const hc = await hciService.getByNumeroVisita(parseInt(numeroVisita));
    
    res.json({
      success: true,
      data: hc
    });
    
  } catch (error) {
    console.error('Error al obtener HC por visita:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener historia clínica',
      error: error.message
    });
  }
};

/**
 * Obtiene HC por ID
 */
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID es requerido'
      });
    }
    
    const hc = await hciService.getById(parseInt(id));
    
    res.json({
      success: true,
      data: hc
    });
    
  } catch (error) {
    console.error('Error al obtener HC por ID:', error);
    
    if (error.message === 'Historia clínica no encontrada') {
      return res.status(404).json({
        success: false,
        mensaje: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener historia clínica',
      error: error.message
    });
  }
};

/**
 * Obtiene HC por ID de paciente
 */
exports.getByIdPaciente = async (req, res) => {
  try {
    const { idPaciente } = req.params;
    
    if (!idPaciente) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID de paciente es requerido'
      });
    }
    
    const hc = await hciService.getByIdPaciente(parseInt(idPaciente));
    
    res.json({
      success: true,
      data: hc
    });
    
  } catch (error) {
    console.error('Error al obtener HC por paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener historia clínica',
      error: error.message
    });
  }
};

/**
 * Crea una nueva HC
 */
exports.crear = async (req, res) => {
  try {
    const data = req.body;
    
    // Validar campos requeridos
    if (!data.NumeroVisita) {
      return res.status(400).json({
        success: false,
        mensaje: 'Número de visita es requerido'
      });
    }
    
    const hc = await hciService.crear(data);
    
    res.status(201).json({
      success: true,
      data: hc,
      mensaje: 'Historia clínica creada exitosamente'
    });
    
  } catch (error) {
    console.error('Error al crear HC:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al crear historia clínica',
      error: error.message
    });
  }
};

/**
 * Actualiza una HC existente
 */
exports.actualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID es requerido'
      });
    }
    
    const hc = await hciService.actualizar(parseInt(id), data);
    
    res.json({
      success: true,
      data: hc,
      mensaje: 'Historia clínica actualizada exitosamente'
    });
    
  } catch (error) {
    console.error('Error al actualizar HC:', error);
    
    if (error.message === 'Historia clínica no encontrada') {
      return res.status(404).json({
        success: false,
        mensaje: error.message
      });
    }
    
    if (error.message === 'No hay campos para actualizar') {
      return res.status(400).json({
        success: false,
        mensaje: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar historia clínica',
      error: error.message
    });
  }
};

/**
 * Elimina una HC
 */
exports.eliminar = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID es requerido'
      });
    }
    
    await hciService.eliminar(parseInt(id));
    
    res.json({
      success: true,
      mensaje: 'Historia clínica eliminada exitosamente'
    });
    
  } catch (error) {
    console.error('Error al eliminar HC:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al eliminar historia clínica',
      error: error.message
    });
  }
};
