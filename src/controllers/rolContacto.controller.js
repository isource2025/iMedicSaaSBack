/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imRolContacto
 * @module controllers/rolContacto.controller
 */

const rolContactoService = require('../services/rolContacto.service');

/**
 * Controlador para gestionar las operaciones con la tabla imRolContacto
 */
const rolContactoController = {
  /**
   * Obtiene todos los roles de contacto
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con los resultados o mensaje de error
   */
  getRolesContacto: async (req, res) => {
    try {
      const rolesContacto = await rolContactoService.getRolesContacto();
      res.json({
        success: true,
        data: rolesContacto
      });
    } catch (error) {
      console.error('Error en el controlador de roles de contacto:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener los roles de contacto',
        error: error.message
      });
    }
  },

  /**
   * Obtiene un rol de contacto por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el rol de contacto encontrado o mensaje de error
   */
  getRolContacto: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      const rolContacto = await rolContactoService.getRolContacto(valor);
      
      if (!rolContacto) {
        return res.status(404).json({
          success: false,
          message: `No se encontró un rol de contacto con el valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: rolContacto
      });
    } catch (error) {
      console.error('Error en el controlador de roles de contacto:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener el rol de contacto',
        error: error.message
      });
    }
  },

  /**
   * Crea un nuevo rol de contacto
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el rol de contacto creado o mensaje de error
   */
  createRolContacto: async (req, res) => {
    try {
      const { Valor, Descripcion } = req.body;
      
      // Validación básica de los datos
      if (!Valor || !Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios'
        });
      }
      
      // Validar formato del valor (3 caracteres máximo)
      if (Valor.length > 3) {
        return res.status(400).json({
          success: false,
          message: 'El Valor debe tener como máximo 3 caracteres'
        });
      }
      
      // Validar longitud de la descripción
      if (Descripcion.length > 80) {
        return res.status(400).json({
          success: false,
          message: 'La Descripción no puede exceder los 80 caracteres'
        });
      }
      
      const nuevoRolContacto = {
        Valor,
        Descripcion
      };
      
      const rolContactoCreado = await rolContactoService.createRolContacto(nuevoRolContacto);
      
      res.status(201).json({
        success: true,
        message: 'Rol de contacto creado correctamente',
        data: rolContactoCreado
      });
    } catch (error) {
      console.error('Error en el controlador de roles de contacto:', error);
      
      // Si es un error de validación (como rol de contacto duplicado)
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al crear el rol de contacto',
        error: error.message
      });
    }
  },

  /**
   * Actualiza un rol de contacto existente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el rol de contacto actualizado o mensaje de error
   */
  updateRolContacto: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      const { Descripcion } = req.body;
      
      if (!Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'La descripción es obligatoria'
        });
      }
      
      // Validar longitud de la descripción
      if (Descripcion.length > 80) {
        return res.status(400).json({
          success: false,
          message: 'La Descripción no puede exceder los 80 caracteres'
        });
      }
      
      const rolContactoActualizado = await rolContactoService.updateRolContacto(valor, Descripcion);
      
      res.json({
        success: true,
        message: 'Rol de contacto actualizado correctamente',
        data: rolContactoActualizado
      });
    } catch (error) {
      console.error('Error en el controlador de roles de contacto:', error);
      
      // Si no existe el rol de contacto
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al actualizar el rol de contacto',
        error: error.message
      });
    }
  },

  /**
   * Elimina un rol de contacto
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con mensaje de éxito o error
   */
  deleteRolContacto: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      await rolContactoService.deleteRolContacto(valor);
      
      res.json({
        success: true,
        message: `Rol de contacto con valor ${valor} eliminado correctamente`
      });
    } catch (error) {
      console.error('Error en el controlador de roles de contacto:', error);
      
      // Si no existe el rol de contacto
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al eliminar el rol de contacto',
        error: error.message
      });
    }
  }
};

module.exports = rolContactoController;
