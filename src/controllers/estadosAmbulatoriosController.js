const estadosAmbulatoriosService = require('../services/estadosAmbulatoriosService');

/**
 * Controlador para manejar las operaciones relacionadas con los estados ambulatorios
 */
const estadosAmbulatoriosController = {
  /**
   * Obtiene todos los estados ambulatorios
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  getAll: async (req, res) => {
    try {
      const estadosAmbulatorios = await estadosAmbulatoriosService.getAll();
      res.json(estadosAmbulatorios);
    } catch (error) {
      console.error('Error al obtener estados ambulatorios:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error al obtener los estados ambulatorios',
        error: error.message 
      });
    }
  },

  /**
   * Obtiene un estado ambulatorio por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   */
  getByValor: async (req, res) => {
    try {
      const { valor } = req.params;
      const estadoAmbulatorio = await estadosAmbulatoriosService.getByValor(valor);
      
      if (!estadoAmbulatorio) {
        return res.status(404).json({ 
          success: false, 
          message: `No se encontró el estado ambulatorio con valor ${valor}` 
        });
      }
      
      res.json(estadoAmbulatorio);
    } catch (error) {
      console.error(`Error al obtener estado ambulatorio con valor ${req.params.valor}:`, error);
      res.status(500).json({ 
        success: false, 
        message: 'Error al obtener el estado ambulatorio',
        error: error.message 
      });
    }
  }
};

module.exports = estadosAmbulatoriosController;
