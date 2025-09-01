/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imParentesco
 * @module controllers/parentesco.controller
 */

const parentescoService = require('../services/parentesco.service');

/**
 * Controlador para manejar operaciones CRUD sobre la tabla imParentesco
 */
const parentescoController = {
  /**
   * Obtiene todos los registros de parentesco
   * @param {object} req - Objeto de solicitud Express
   * @param {object} res - Objeto de respuesta Express
   */
  getParentescos: async (req, res) => {
    try {
      const data = await parentescoService.getParentescos();
      
      res.json({
        success: true,
        data,
        message: 'Registros de parentescos obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de parentescos:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener registros de parentescos'
      });
    }
  },

  /**
   * Obtiene un registro de parentesco por su valor
   * @param {object} req - Objeto de solicitud Express con parámetro 'valor'
   * @param {object} res - Objeto de respuesta Express
   */
  getParentesco: async (req, res) => {
    try {
      const { valor } = req.params;

      if (!valor) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'El parámetro valor es obligatorio'
        });
      }

      const data = await parentescoService.getParentesco(valor);

      if (!data) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró un parentesco con el valor ${valor}`
        });
      }

      res.json({
        success: true,
        data,
        message: 'Parentesco obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de parentescos:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener el parentesco'
      });
    }
  },

  /**
   * Crea un nuevo registro de parentesco
   * @param {object} req - Objeto de solicitud Express con cuerpo que contiene Valor y Descripcion
   * @param {object} res - Objeto de respuesta Express
   */
  createParentesco: async (req, res) => {
    try {
      const { Valor, Descripcion } = req.body;

      if (!Valor || !Descripcion) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'El valor y la descripción son obligatorios'
        });
      }

      const data = await parentescoService.createParentesco({ Valor, Descripcion });

      res.status(201).json({
        success: true,
        data,
        message: 'Parentesco creado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de parentescos:', error);
      res.status(error.message.includes('Ya existe') ? 409 : 500).json({
        success: false,
        data: null,
        message: error.message || 'Error al crear el parentesco'
      });
    }
  },

  /**
   * Actualiza un registro de parentesco existente
   * @param {object} req - Objeto de solicitud Express con parámetro 'valor' y cuerpo con Descripcion
   * @param {object} res - Objeto de respuesta Express
   */
  updateParentesco: async (req, res) => {
    try {
      const { valor } = req.params;
      const { Descripcion } = req.body;

      if (!valor || !Descripcion) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'El valor y la descripción son obligatorios'
        });
      }

      const data = await parentescoService.updateParentesco(valor, Descripcion);

      res.json({
        success: true,
        data,
        message: 'Parentesco actualizado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de parentescos:', error);
      res.status(error.message.includes('No existe') ? 404 : 500).json({
        success: false,
        data: null,
        message: error.message || 'Error al actualizar el parentesco'
      });
    }
  },

  /**
   * Elimina un registro de parentesco
   * @param {object} req - Objeto de solicitud Express con parámetro 'valor'
   * @param {object} res - Objeto de respuesta Express
   */
  deleteParentesco: async (req, res) => {
    try {
      const { valor } = req.params;

      if (!valor) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'El parámetro valor es obligatorio'
        });
      }

      await parentescoService.deleteParentesco(valor);

      res.json({
        success: true,
        data: null,
        message: 'Parentesco eliminado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de parentescos:', error);
      res.status(error.message.includes('No existe') ? 404 : 500).json({
        success: false,
        data: null,
        message: error.message || 'Error al eliminar el parentesco'
      });
    }
  }
};

module.exports = parentescoController;
