/**
 * @fileoverview Servicio para manejar operaciones relacionadas con la tabla imParentesco
 * @module services/parentesco.service
 */

const { executeQuery } = require('../models/db');

/**
 * Servicio para manejar operaciones CRUD sobre la tabla imParentesco
 */
const parentescoService = {
  /**
   * Obtiene todos los registros de parentesco
   * @returns {Promise<Array>} Promesa que resuelve a un array de objetos de parentesco
   */
  getParentescos: async () => {
    try {
      const query = `
        SELECT Valor, Descripcion
        FROM imParentesco
        ORDER BY Descripcion
      `;
      
      // Ejecuta la consulta
      const parentescos = await executeQuery(query);
      
      return parentescos || [];
    } catch (error) {
      console.error('Error en el servicio de parentescos:', error);
      throw new Error('Error al consultar los parentescos');
    }
  },

  /**
   * Obtiene un registro de parentesco por su valor
   * @param {string} valor - Valor único del parentesco
   * @returns {Promise<Object|null>} Promesa que resuelve al objeto parentesco o null si no existe
   */
  getParentesco: async (valor) => {
    try {
      const query = `
        SELECT Valor, Descripcion
        FROM imParentesco
        WHERE Valor = ?
      `;

      const results = await executeQuery(query, [valor]);

      // Si no hay resultados, retorna null
      if (!results || results.length === 0) {
        return null;
      }

      return results[0];
    } catch (error) {
      console.error('Error en el servicio de parentescos:', error);
      throw new Error(`Error al consultar el parentesco con valor ${valor}`);
    }
  },

  /**
   * Crea un nuevo registro de parentesco
   * @param {Object} parentesco - Objeto con los datos del parentesco
   * @param {string} parentesco.Valor - Identificador único del parentesco (máximo 3 caracteres)
   * @param {string} parentesco.Descripcion - Descripción del parentesco (máximo 40 caracteres)
   * @returns {Promise<Object>} Promesa que resuelve al parentesco creado
   */
  createParentesco: async (parentesco) => {
    try {
      // Validaciones básicas
      if (!parentesco.Valor || !parentesco.Descripcion) {
        throw new Error('El valor y la descripción son obligatorios');
      }

      if (parentesco.Valor.length > 3) {
        throw new Error('El valor no puede tener más de 3 caracteres');
      }

      if (parentesco.Descripcion.length > 40) {
        throw new Error('La descripción no puede tener más de 40 caracteres');
      }

      // Comprueba si ya existe un parentesco con ese valor
      const parentescoExistente = await parentescoService.getParentesco(parentesco.Valor);
      if (parentescoExistente) {
        throw new Error(`Ya existe un parentesco con el valor ${parentesco.Valor}`);
      }

      // Inserta el nuevo parentesco
      const query = `
        INSERT INTO imParentesco (Valor, Descripcion)
        VALUES (?, ?)
      `;

      await executeQuery(query, [parentesco.Valor, parentesco.Descripcion]);

      return parentesco;
    } catch (error) {
      console.error('Error en el servicio de parentescos:', error);
      throw new Error(error.message || 'Error al crear el parentesco');
    }
  },

  /**
   * Actualiza un registro de parentesco existente
   * @param {string} valor - Valor único del parentesco a actualizar
   * @param {string} descripcion - Nueva descripción para el parentesco
   * @returns {Promise<Object>} Promesa que resuelve al parentesco actualizado
   */
  updateParentesco: async (valor, descripcion) => {
    try {
      // Validaciones básicas
      if (!descripcion) {
        throw new Error('La descripción es obligatoria');
      }

      if (descripcion.length > 40) {
        throw new Error('La descripción no puede tener más de 40 caracteres');
      }

      // Comprueba si existe el parentesco
      const parentescoExistente = await parentescoService.getParentesco(valor);
      if (!parentescoExistente) {
        throw new Error(`No existe un parentesco con el valor ${valor}`);
      }

      // Actualiza el parentesco
      const query = `
        UPDATE imParentesco
        SET Descripcion = ?
        WHERE Valor = ?
      `;

      await executeQuery(query, [descripcion, valor]);

      return {
        Valor: valor,
        Descripcion: descripcion
      };
    } catch (error) {
      console.error('Error en el servicio de parentescos:', error);
      throw new Error(error.message || `Error al actualizar el parentesco con valor ${valor}`);
    }
  },

  /**
   * Elimina un registro de parentesco
   * @param {string} valor - Valor único del parentesco a eliminar
   * @returns {Promise<boolean>} Promesa que resuelve a true si se eliminó correctamente
   */
  deleteParentesco: async (valor) => {
    try {
      // Comprueba si existe el parentesco
      const parentescoExistente = await parentescoService.getParentesco(valor);
      if (!parentescoExistente) {
        throw new Error(`No existe un parentesco con el valor ${valor}`);
      }

      // Elimina el parentesco
      const query = `
        DELETE FROM imParentesco
        WHERE Valor = ?
      `;

      await executeQuery(query, [valor]);

      return true;
    } catch (error) {
      console.error('Error en el servicio de parentescos:', error);
      throw new Error(error.message || `Error al eliminar el parentesco con valor ${valor}`);
    }
  }
};

module.exports = parentescoService;
