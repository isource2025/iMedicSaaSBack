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
   * Obtiene un registro de la tabla imLocalidades por su descrpción
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getLocalidadByDescripcion: async (req, res) => {
    try {
      const { localidad } = req.params;

      if (!localidad) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere una descripción de localidad'
        });
      }

      const valor = await localidadService.getLocalidadByDescripcion(localidad);

      if (!valor) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró registro con descripción ${localidad}`
        });
      }
      
      res.json({
        data: valor,
      });
    } catch (error) {
      console.error('Error en controlador de localidad por descripción:', error);
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
      const { Valor, CodigoPostal, NombreLocalidad, ValorProvincia } = req.body;
      
      // Validar datos requeridos
      if (Valor === undefined || Valor === null) {
        return res.status(400).json({
          success: false,
          message: 'El campo Valor es obligatorio'
        });
      }
      
      if (!NombreLocalidad) {
        return res.status(400).json({
          success: false,
          message: 'El nombre de la localidad es obligatorio'
        });
      }
      
      // Construir el objeto localidad
      const localidadData = {
        Valor,
        CodigoPostal,
        NombreLocalidad,
        ValorProvincia
      };
      
      const result = await localidadService.createLocalidad(localidadData);
      
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
      const { CodigoPostal, NombreLocalidad, ValorProvincia } = req.body;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de localidad'
        });
      }
      
      // Validar los datos requeridos
      if (!NombreLocalidad) {
        return res.status(400).json({
          success: false,
          message: 'El nombre de la localidad es obligatorio'
        });
      }
      
      // Construir el objeto con los datos a actualizar
      const localidadData = {
        CodigoPostal,
        NombreLocalidad,
        ValorProvincia
      };
      
      const result = await localidadService.updateLocalidad(valor, localidadData);
      
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
