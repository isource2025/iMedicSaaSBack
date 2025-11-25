/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la tabla imRequisitos
 * @module services/requisito.service
 */

const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar los requisitos de clientes
 */
const requisitoService = {
  /**
   * Obtiene todos los requisitos
   * @returns {Promise<Array>} Lista de requisitos
   */
  getRequisitos: async () => {
    try {
      const query = 'SELECT Valor, Descripcion, AplicableAlPacienteOVisita FROM imRequisitos ORDER BY Descripcion';
      const result = await executeQuery(query);
      
      return result;
    } catch (error) {
      console.error('Error al obtener requisitos:', error);
      throw error;
    }
  },

  /**
   * Obtiene un requisito específico por su valor
   * @param {number} valor - Valor del requisito a buscar
   * @returns {Promise<Object|null>} Requisito encontrado o null
   */
  getRequisito: async (valor) => {
    try {
      const query = 'SELECT Valor, Descripcion, AplicableAlPaciente FROM imRequisitos WHERE Valor = ?';
      const result = await executeQuery(query, [valor]);
      
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener requisito con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea un nuevo requisito
   * @param {Object} requisito - Datos del requisito a crear
   * @param {number} requisito.Valor - Valor del requisito
   * @param {string} requisito.Descripcion - Descripción del requisito
   * @param {string} requisito.AplicableAlPaciente - Indica si es aplicable al paciente
   * @returns {Promise<Object>} Requisito creado
   */
  createRequisito: async (requisito) => {
    try {
      // Validar que todos los campos requeridos estén presentes
      if (!requisito.Valor && requisito.Valor !== 0 || !requisito.Descripcion || !requisito.AplicableAlPaciente) {
        throw new Error('Todos los campos son obligatorios');
      }
      
      // Validar que el valor sea un número válido
      if (typeof requisito.Valor !== 'number' || requisito.Valor < 0 || requisito.Valor > 255) {
        throw new Error('El valor debe ser un número entre 0 y 255');
      }
      
      // Validar longitud de los campos
      if (requisito.Descripcion.length > 40) {
        throw new Error('La descripción no puede exceder los 40 caracteres');
      }
      
      if (requisito.AplicableAlPaciente.length > 10) {
        throw new Error('El campo AplicableAlPaciente no puede exceder los 10 caracteres');
      }
      
      // Verificar si ya existe un requisito con el mismo valor
      const existingRequisito = await requisitoService.getRequisito(requisito.Valor);
      if (existingRequisito) {
        throw new Error(`Ya existe un requisito con el valor ${requisito.Valor}`);
      }
      
      // Insertar el nuevo requisito
      const query = 'INSERT INTO imRequisitos (Valor, Descripcion, AplicableAlPaciente) VALUES (?, ?, ?)';
      await executeQuery(query, [requisito.Valor, requisito.Descripcion, requisito.AplicableAlPaciente]);
      
      // Devolver el requisito recién creado
      return await requisitoService.getRequisito(requisito.Valor);
    } catch (error) {
      console.error('Error al crear requisito:', error);
      throw error;
    }
  },

  /**
   * Actualiza un requisito existente
   * @param {number} valor - Valor del requisito a actualizar
   * @param {Object} datos - Datos a actualizar
   * @param {string} [datos.Descripcion] - Nueva descripción
   * @param {string} [datos.AplicableAlPaciente] - Nuevo valor para AplicableAlPaciente
   * @returns {Promise<Object>} Requisito actualizado
   */
  updateRequisito: async (valor, datos) => {
    try {
      // Verificar si el requisito existe
      const existingRequisito = await requisitoService.getRequisito(valor);
      if (!existingRequisito) {
        throw new Error(`No existe un requisito con el valor ${valor}`);
      }
      
      // Validar longitud de los campos si están presentes
      if (datos.Descripcion && datos.Descripcion.length > 40) {
        throw new Error('La descripción no puede exceder los 40 caracteres');
      }
      
      if (datos.AplicableAlPaciente && datos.AplicableAlPaciente.length > 10) {
        throw new Error('El campo AplicableAlPaciente no puede exceder los 10 caracteres');
      }
      
      // Construir la consulta de actualización dinámicamente
      let query = 'UPDATE imRequisitos SET ';
      const params = [];
      const updateFields = [];
      
      if (datos.Descripcion !== undefined) {
        updateFields.push('Descripcion = ?');
        params.push(datos.Descripcion);
      }
      
      if (datos.AplicableAlPaciente !== undefined) {
        updateFields.push('AplicableAlPaciente = ?');
        params.push(datos.AplicableAlPaciente);
      }
      
      // Si no hay campos para actualizar, lanzar error
      if (updateFields.length === 0) {
        throw new Error('No se proporcionaron campos para actualizar');
      }
      
      query += updateFields.join(', ') + ' WHERE Valor = ?';
      params.push(valor);
      
      // Ejecutar la actualización
      await executeQuery(query, params);
      
      // Devolver el requisito actualizado
      return await requisitoService.getRequisito(valor);
    } catch (error) {
      console.error(`Error al actualizar requisito con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina un requisito
   * @param {number} valor - Valor del requisito a eliminar
   * @returns {Promise<void>}
   */
  deleteRequisito: async (valor) => {
    try {
      // Verificar si el requisito existe
      const existingRequisito = await requisitoService.getRequisito(valor);
      if (!existingRequisito) {
        throw new Error(`No existe un requisito con el valor ${valor}`);
      }
      
      // Eliminar el requisito
      const query = 'DELETE FROM imRequisitos WHERE Valor = ?';
      await executeQuery(query, [valor]);
    } catch (error) {
      console.error(`Error al eliminar requisito con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = requisitoService;
