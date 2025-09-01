const opcGrdService = require('../services/opcGrd.service');

/**
 * Controlador para gestionar las operaciones CRUD de la tabla imOpcGrd
 */
const opcGrdController = {
  /**
   * Obtiene todas las opciones de grilla
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getAllOpcGrd: async (req, res) => {
    try {
      const data = await opcGrdService.getAllOpcGrd();
      
      res.json({
        success: true,
        data,
        message: 'Opciones de grilla obtenidas correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de opciones de grilla:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener opciones de grilla'
      });
    }
  },

  /**
   * Obtiene una opción de grilla por su ID
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getOpcGrdById: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un ID de opción de grilla'
        });
      }
      
      const opcGrd = await opcGrdService.getOpcGrdById(id);
      
      if (!opcGrd) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró opción de grilla con ID ${id}`
        });
      }
      
      res.json({
        success: true,
        data: opcGrd,
        message: 'Opción de grilla obtenida correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de opción de grilla por ID:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener opción de grilla'
      });
    }
  },

  /**
   * Crea una nueva opción de grilla
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  createOpcGrd: async (req, res) => {
    try {
      const { descripcion } = req.body;
      
      if (!descripcion) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere una descripción para la opción de grilla'
        });
      }
      
      // Por ahora hardcodeamos el usuario como 'admin'
      const usuarioCreacion = 'admin';
      
      const opcGrd = await opcGrdService.createOpcGrd({
        descripcion,
        usuarioCreacion
      });
      
      res.status(201).json({
        success: true,
        data: opcGrd,
        message: 'Opción de grilla creada correctamente'
      });
    } catch (error) {
      console.error('Error en controlador al crear opción de grilla:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al crear opción de grilla'
      });
    }
  },

  /**
   * Actualiza una opción de grilla existente
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  updateOpcGrd: async (req, res) => {
    try {
      const { id } = req.params;
      const { descripcion } = req.body;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un ID de opción de grilla'
        });
      }
      
      if (!descripcion) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere una descripción para la opción de grilla'
        });
      }
      
      // Verificar si la opción existe
      const existingOpcGrd = await opcGrdService.getOpcGrdById(id);
      
      if (!existingOpcGrd) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró opción de grilla con ID ${id}`
        });
      }
      
      // Por ahora hardcodeamos el usuario como 'admin'
      const usuarioModificacion = 'admin';
      
      const updatedOpcGrd = await opcGrdService.updateOpcGrd(id, {
        descripcion,
        usuarioModificacion
      });
      
      res.json({
        success: true,
        data: updatedOpcGrd,
        message: 'Opción de grilla actualizada correctamente'
      });
    } catch (error) {
      console.error('Error en controlador al actualizar opción de grilla:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al actualizar opción de grilla'
      });
    }
  },

  /**
   * Elimina (borrado lógico) una opción de grilla
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  deleteOpcGrd: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un ID de opción de grilla'
        });
      }
      
      // Verificar si la opción existe
      const existingOpcGrd = await opcGrdService.getOpcGrdById(id);
      
      if (!existingOpcGrd) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró opción de grilla con ID ${id}`
        });
      }
      
      // Por ahora hardcodeamos el usuario como 'admin'
      const usuario = 'admin';
      
      await opcGrdService.deleteOpcGrd(id, usuario);
      
      res.json({
        success: true,
        data: null,
        message: 'Opción de grilla eliminada correctamente'
      });
    } catch (error) {
      console.error('Error en controlador al eliminar opción de grilla:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al eliminar opción de grilla'
      });
    }
  }
};

module.exports = opcGrdController;
