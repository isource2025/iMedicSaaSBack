/**
 * Controlador para gestionar la tabla de nacionalidades (imNacionalidad)
 */
const nacionalidadService = require('../services/nacionalidad.service');

/**
 * Controlador para gestionar las peticiones HTTP relacionadas con nacionalidades
 */
const nacionalidadController = {
  /**
   * Obtiene todas las nacionalidades
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getNacionalidades: async (req, res) => {
    try {
      const data = await nacionalidadService.getNacionalidades();
      
      res.json({
        success: true,
        data,
        message: 'Registros de nacionalidades obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de nacionalidades:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener registros de nacionalidades'
      });
    }
  },

  /**
   * Obtiene una nacionalidad por su valor
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getNacionalidadByValor: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un valor de nacionalidad'
        });
      }
      
      const nacionalidad = await nacionalidadService.getNacionalidadByValor(valor);
      
      if (!nacionalidad) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró registro con valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: nacionalidad,
        message: 'Registro de nacionalidad obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de nacionalidad por valor:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener registro de nacionalidad'
      });
    }
  },
  
  /**
   * Crea un nuevo registro en la tabla imNacionalidad
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  createNacionalidad: async (req, res) => {
    try {
      const { Valor, Descripcion } = req.body;
      
      // Validar datos requeridos
      if (!Valor) {
        return res.status(400).json({
          success: false,
          message: 'El campo Valor es obligatorio'
        });
      }
      
      if (!Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'El campo Descripcion es obligatorio'
        });
      }
      
      const result = await nacionalidadService.createNacionalidad({ Valor, Descripcion });
      
      res.status(201).json({
        success: true,
        message: 'Registro de nacionalidad creado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de creación de nacionalidad:', error);
      
      // Si ya existe un registro con el mismo valor
      if (error.message.includes('Ya existe un registro')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al crear registro de nacionalidad'
      });
    }
  },
  
  /**
   * Actualiza un registro existente en la tabla imNacionalidad
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  updateNacionalidad: async (req, res) => {
    try {
      const { valor } = req.params;
      const { Descripcion } = req.body;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de nacionalidad'
        });
      }
      
      // Validar los datos requeridos
      if (!Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'La descripción es obligatoria'
        });
      }
      
      const result = await nacionalidadService.updateNacionalidad(valor, { Descripcion });
      
      res.json({
        success: true,
        message: 'Registro de nacionalidad actualizado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de actualización de nacionalidad:', error);
      
      // Si no existe el registro
      if (error.message.includes('No existe un registro')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al actualizar registro de nacionalidad'
      });
    }
  },
  
  /**
   * Elimina un registro de la tabla imNacionalidad
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  deleteNacionalidad: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de nacionalidad'
        });
      }
      
      const result = await nacionalidadService.deleteNacionalidad(valor);
      
      res.json({
        success: true,
        message: 'Registro de nacionalidad eliminado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de eliminación de nacionalidad:', error);
      
      // Si no existe el registro
      if (error.message.includes('No existe un registro')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al eliminar registro de nacionalidad'
      });
    }
  }
};

module.exports = nacionalidadController;
