const localidadService = require('../services/localidad.service');

/**
 * Controlador para gestionar la tabla imLocalidades
 */
const localidadController = {
  /**
   * Obtiene todos los registros de la tabla imLocalidades
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getLocalidades: async (req, res) => {
    try {
      const data = await localidadService.getLocalidades();
      
      res.json({
        success: true,
        data,
        message: 'Registros de localidades obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de localidades:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener registros de localidades'
      });
    }
  },

  /**
   * Obtiene un registro de la tabla imLocalidades por su valor
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getLocalidadByValor: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un valor de localidad'
        });
      }
      
      const localidad = await localidadService.getLocalidadByValor(valor);
      
      if (!localidad) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró registro con valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: localidad,
        message: 'Registro de localidad obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de localidad por valor:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener registro de localidad'
      });
    }
  },

  /**
   * Crea un nuevo registro en la tabla imLocalidades
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  createLocalidad: async (req, res) => {
    try {
      const { valor, descripcion } = req.body;
      
      // Validar datos requeridos
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El campo valor es obligatorio'
        });
      }
      
      const result = await localidadService.createLocalidad({ valor, descripcion });
      
      res.status(201).json({
        success: true,
        message: 'Registro de localidad creado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de creación de localidad:', error);
      
      // Si ya existe un registro con el mismo valor
      if (error.message.includes('Ya existe un registro')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al crear registro de localidad'
      });
    }
  },

  /**
   * Actualiza un registro existente en la tabla imLocalidades
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  updateLocalidad: async (req, res) => {
    try {
      const { valor } = req.params;
      const { descripcion } = req.body;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de localidad'
        });
      }
      
      const result = await localidadService.updateLocalidad(valor, { descripcion });
      
      res.json({
        success: true,
        message: 'Registro de localidad actualizado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de actualización de localidad:', error);
      
      // Si no existe el registro
      if (error.message.includes('No existe un registro')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al actualizar registro de localidad'
      });
    }
  },

  /**
   * Elimina un registro de la tabla imLocalidades
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  deleteLocalidad: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de localidad'
        });
      }
      
      const result = await localidadService.deleteLocalidad(valor);
      
      res.json({
        success: true,
        message: 'Registro de localidad eliminado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de eliminación de localidad:', error);
      
      // Si no existe el registro
      if (error.message.includes('No existe un registro')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al eliminar registro de localidad'
      });
    }
  }
};

module.exports = localidadController;
