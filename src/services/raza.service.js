/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la entidad Raza
 * @module services/raza.service
 */

const { executeQuery } = require('../config/database');

/**
 * Servicio para gestionar las razas
 */
const razaService = {
  /**
   * Obtiene todas las razas
   * @returns {Promise<Array>} Lista de razas
   */
  getRazas: async () => {
    try {
      const query = 'SELECT Valor, Descripcion FROM imRaza ORDER BY Descripcion';
      const result = await executeQuery(query);
      
      return result;
    } catch (error) {
      console.error('Error al obtener razas:', error);
      throw error;
    }
  },

  /**
   * Obtiene una raza específica por su valor
   * @param {number} valor - Valor de la raza a buscar
   * @returns {Promise<Object|null>} Raza encontrada o null
   */
  getRaza: async (valor) => {
    try {
      const query = 'SELECT Valor, Descripcion FROM imRaza WHERE Valor = ?';
      const result = await executeQuery(query, [valor]);
      
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener raza con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea una nueva raza
   * @param {Object} raza - Datos de la raza a crear
   * @param {number} raza.Valor - Valor numérico de la raza
   * @param {string} raza.Descripcion - Descripción de la raza
   * @returns {Promise<Object>} Raza creada
   */
  createRaza: async (raza) => {
    try {
      // Validar que todos los campos requeridos estén presentes
      if (!raza.Valor || !raza.Descripcion) {
        throw new Error('Todos los campos son obligatorios');
      }
      
      // Verificar si ya existe una raza con el mismo valor
      const existingRaza = await razaService.getRaza(raza.Valor);
      if (existingRaza) {
        throw new Error(`Ya existe una raza con el valor ${raza.Valor}`);
      }
      
      // Insertar la nueva raza
      const query = 'INSERT INTO imRaza (Valor, Descripcion) VALUES (?, ?)';
      await executeQuery(query, [raza.Valor, raza.Descripcion]);
      
      // Devolver la raza recién creada
      return await razaService.getRaza(raza.Valor);
    } catch (error) {
      console.error('Error al crear raza:', error);
      throw error;
    }
  },

  /**
   * Actualiza una raza existente
   * @param {number} valor - Valor de la raza a actualizar
   * @param {string} descripcion - Nueva descripción
   * @returns {Promise<Object>} Raza actualizada
   */
  updateRaza: async (valor, descripcion) => {
    try {
      // Validar que la descripción no esté vacía
      if (!descripcion) {
        throw new Error('La descripción no puede estar vacía');
      }
      
      // Verificar si la raza existe
      const existingRaza = await razaService.getRaza(valor);
      if (!existingRaza) {
        throw new Error(`No existe una raza con el valor ${valor}`);
      }
      
      // Actualizar la raza
      const query = 'UPDATE imRaza SET Descripcion = ? WHERE Valor = ?';
      await executeQuery(query, [descripcion, valor]);
      
      // Devolver la raza actualizada
      return await razaService.getRaza(valor);
    } catch (error) {
      console.error(`Error al actualizar raza con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina una raza
   * @param {number} valor - Valor de la raza a eliminar
   * @returns {Promise<void>}
   */
  deleteRaza: async (valor) => {
    try {
      // Verificar si la raza existe
      const existingRaza = await razaService.getRaza(valor);
      if (!existingRaza) {
        throw new Error(`No existe una raza con el valor ${valor}`);
      }
      
      // Eliminar la raza
      const query = 'DELETE FROM imRaza WHERE Valor = ?';
      await executeQuery(query, [valor]);
    } catch (error) {
      console.error(`Error al eliminar raza con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = razaService;
