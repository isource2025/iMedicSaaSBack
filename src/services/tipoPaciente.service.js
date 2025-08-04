/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la tabla imTipoPaciente
 * @module services/tipoPaciente.service
 */

const { executeQuery } = require('../config/database');

/**
 * Servicio para gestionar los tipos de paciente
 */
const tipoPacienteService = {
  /**
   * Obtiene todos los tipos de paciente
   * @returns {Promise<Array>} Lista de tipos de paciente
   */
  getTiposPaciente: async () => {
    try {
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(1)) AS valor, 
          descripcion 
        FROM 
          imTipoPaciente 
        ORDER BY 
          descripcion
      `;
      
      const result = await executeQuery(query);
      return result || [];
    } catch (error) {
      console.error('Error al obtener tipos de paciente:', error);
      throw error;
    }
  },

  /**
   * Obtiene un tipo de paciente específico por su valor
   * @param {string} valor - Valor del tipo de paciente a buscar
   * @returns {Promise<Object|null>} Tipo de paciente encontrado o null
   */
  getTipoPaciente: async (valor) => {
    try {
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(1)) AS valor, 
          descripcion 
        FROM 
          imTipoPaciente 
        WHERE 
          valor = @p0
      `;
      
      const result = await executeQuery(query, [
        { value: valor }
      ]);
      
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener tipo de paciente con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea un nuevo tipo de paciente
   * @param {Object} tipoPaciente - Datos del tipo de paciente a crear
   * @param {string} tipoPaciente.valor - Valor del tipo de paciente (1 carácter)
   * @param {string} tipoPaciente.descripcion - Descripción del tipo de paciente
   * @returns {Promise<Object>} Resultado de la operación
   */
  createTipoPaciente: async (tipoPaciente) => {
    try {
      // Validar que todos los campos requeridos estén presentes
      if (!tipoPaciente.valor || !tipoPaciente.descripcion) {
        throw new Error('Todos los campos son obligatorios');
      }
      
      // Validar que el valor tenga el formato correcto (1 carácter)
      if (tipoPaciente.valor.length !== 1) {
        throw new Error('El valor debe tener exactamente 1 carácter');
      }
      
      // Validar longitud de la descripción
      if (tipoPaciente.descripcion.length > 20) {
        throw new Error('La descripción no puede exceder los 20 caracteres');
      }
      
      // Verificar si ya existe un tipo de paciente con el mismo valor
      const existingTipoPaciente = await tipoPacienteService.getTipoPaciente(tipoPaciente.valor);
      if (existingTipoPaciente) {
        throw new Error(`Ya existe un tipo de paciente con el valor ${tipoPaciente.valor}`);
      }
      
      // Insertar el nuevo tipo de paciente
      const query = `
        INSERT INTO imTipoPaciente (valor, descripcion) 
        VALUES (@p0, @p1)
      `;
      
      await executeQuery(query, [
        { value: tipoPaciente.valor },
        { value: tipoPaciente.descripcion }
      ]);
      
      // Devolver el tipo de paciente recién creado
      return await tipoPacienteService.getTipoPaciente(tipoPaciente.valor);
    } catch (error) {
      console.error('Error al crear tipo de paciente:', error);
      throw error;
    }
  },

  /**
   * Actualiza un tipo de paciente existente
   * @param {string} valor - Valor del tipo de paciente a actualizar
   * @param {string} descripcion - Nueva descripción
   * @returns {Promise<Object>} Resultado de la operación
   */
  updateTipoPaciente: async (valor, descripcion) => {
    try {
      // Validar que la descripción no esté vacía
      if (!descripcion) {
        throw new Error('La descripción no puede estar vacía');
      }
      
      // Validar longitud de la descripción
      if (descripcion.length > 20) {
        throw new Error('La descripción no puede exceder los 20 caracteres');
      }
      
      // Verificar si el tipo de paciente existe
      const existingTipoPaciente = await tipoPacienteService.getTipoPaciente(valor);
      if (!existingTipoPaciente) {
        throw new Error(`No existe un tipo de paciente con el valor ${valor}`);
      }
      
      // Actualizar el tipo de paciente
      const query = `
        UPDATE imTipoPaciente 
        SET descripcion = @p0 
        WHERE valor = @p1
      `;
      
      await executeQuery(query, [
        { value: descripcion },
        { value: valor }
      ]);
      
      // Devolver el tipo de paciente actualizado
      return await tipoPacienteService.getTipoPaciente(valor);
    } catch (error) {
      console.error(`Error al actualizar tipo de paciente con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina un tipo de paciente
   * @param {string} valor - Valor del tipo de paciente a eliminar
   * @returns {Promise<Object>} Resultado de la operación
   */
  deleteTipoPaciente: async (valor) => {
    try {
      // Verificar si el tipo de paciente existe
      const existingTipoPaciente = await tipoPacienteService.getTipoPaciente(valor);
      if (!existingTipoPaciente) {
        throw new Error(`No existe un tipo de paciente con el valor ${valor}`);
      }
      
      // Eliminar el tipo de paciente
      const query = `
        DELETE FROM imTipoPaciente 
        WHERE valor = @p0
      `;
      
      await executeQuery(query, [
        { value: valor }
      ]);
      
      return { success: true, message: 'Tipo de paciente eliminado correctamente' };
    } catch (error) {
      console.error(`Error al eliminar tipo de paciente con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = tipoPacienteService;
