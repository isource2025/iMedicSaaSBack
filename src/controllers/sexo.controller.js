const sexoService = require('../services/sexo.service');

/**
 * Controlador para gestionar la tabla imSexo
 */
const sexoController = {
  /**
   * Obtiene todos los registros de la tabla imSexo
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getSexos: async (req, res) => {
    try {
      const data = await sexoService.getSexos();
      
      res.json({
        success: true,
        data,
        message: 'Registros de sexo obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de sexos:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener registros de sexo'
      });
    }
  },

  /**
   * Obtiene un registro de la tabla imSexo por su valor
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getSexoByValor: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un valor de sexo'
        });
      }
      
      const sexo = await sexoService.getSexoByValor(valor);
      
      if (!sexo) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró registro con valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: sexo,
        message: 'Registro de sexo obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de sexo por valor:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener registro de sexo'
      });
    }
  },

  /**
   * Crea un nuevo registro en la tabla imSexo
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  createSexo: async (req, res) => {
    try {
      const { valor, descripcion } = req.body;
      
      // Validar datos requeridos
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El campo valor es obligatorio'
        });
      }
      
      // Validar longitud del valor (debe ser char(1))
      if (valor.length !== 1) {
        return res.status(400).json({
          success: false,
          message: 'El campo valor debe tener exactamente 1 carácter'
        });
      }
      
      // Validar longitud de la descripción (debe ser varchar(15))
      if (descripcion && descripcion.length > 15) {
        return res.status(400).json({
          success: false,
          message: 'El campo descripción no puede exceder los 15 caracteres'
        });
      }
      
      const result = await sexoService.createSexo({ valor, descripcion });
      
      res.status(201).json({
        success: true,
        message: 'Registro de sexo creado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de creación de sexo:', error);
      
      // Si ya existe un registro con el mismo valor
      if (error.message.includes('Ya existe un registro')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al crear registro de sexo'
      });
    }
  },

  /**
   * Actualiza un registro existente en la tabla imSexo
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  updateSexo: async (req, res) => {
    try {
      const { valor } = req.params;
      const { descripcion } = req.body;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de sexo'
        });
      }
      
      // Validar longitud de la descripción (debe ser varchar(15))
      if (descripcion && descripcion.length > 15) {
        return res.status(400).json({
          success: false,
          message: 'El campo descripción no puede exceder los 15 caracteres'
        });
      }
      
      const result = await sexoService.updateSexo(valor, { descripcion });
      
      res.json({
        success: true,
        message: 'Registro de sexo actualizado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de actualización de sexo:', error);
      
      // Si no existe el registro
      if (error.message.includes('No existe un registro')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al actualizar registro de sexo'
      });
    }
  },

  /**
   * Elimina un registro de la tabla imSexo
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  deleteSexo: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere un valor de sexo'
        });
      }
      
      const result = await sexoService.deleteSexo(valor);
      
      res.json({
        success: true,
        message: 'Registro de sexo eliminado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de eliminación de sexo:', error);
      
      // Si no existe el registro
      if (error.message.includes('No existe un registro')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al eliminar registro de sexo'
      });
    }
  }
};

module.exports = sexoController;
