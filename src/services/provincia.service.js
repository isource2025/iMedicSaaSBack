/**
 * @fileoverview Servicio para manejar operaciones relacionadas con la tabla imProvincia
 * @module services/provincia.service
 */

const { executeQuery } = require('../models/db');

/**
 * Servicio para manejar operaciones CRUD sobre la tabla imProvincia
 */
const provinciaService = {
  /**
   * Obtiene todos los registros de la tabla imProvincia
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */
  getProvincias: async () => {
    try {
      const query = `
        SELECT 
          Valor, 
          LetraProvincia,
          Descripcion,
          ValorNacionalidad
        FROM 
          imProvincia 
        ORDER BY 
          Descripcion
      `;
      
      const provincias = await executeQuery(query);
      
      return provincias || [];
    } catch (error) {
      console.error('Error en el servicio de provincias:', error);
      throw new Error('Error al consultar las provincias');
    }
  },

  /**
   * Obtiene un registro de la tabla imProvincia por su valor
   * @param {number} valor - Valor de la provincia a buscar
   * @returns {Promise<Object|null>} Promesa con el resultado de la consulta
   */
  getProvincia: async (valor) => {
    try {
      const query = `
        SELECT 
          Valor, 
          LetraProvincia,
          Descripcion,
          ValorNacionalidad
        FROM 
          imProvincia 
        WHERE 
          Valor = ?
      `;
      
      const result = await executeQuery(query, [valor]);
      
      if (!result || result.length === 0) {
        return null;
      }
      
      return result[0];
    } catch (error) {
      console.error(`Error al obtener provincia con valor ${valor}:`, error);
      throw new Error(`Error al obtener provincia: ${error.message}`);
    }
  },

  /**
   * Obtiene provincias por nacionalidad
   * @param {string} valorNacionalidad - Código de nacionalidad
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */
  getProvinciasByNacionalidad: async (valorNacionalidad) => {
    try {
      const query = `
        SELECT 
          Valor, 
          LetraProvincia,
          Descripcion,
          ValorNacionalidad
        FROM 
          imProvincia 
        WHERE 
          ValorNacionalidad = ?
        ORDER BY 
          Descripcion
      `;
      
      const result = await executeQuery(query, [valorNacionalidad]);
      return result || [];
    } catch (error) {
      console.error(`Error al obtener provincias para nacionalidad ${valorNacionalidad}:`, error);
      throw new Error(`Error al obtener provincias por nacionalidad: ${error.message}`);
    }
  },

  /**
   * Crea un nuevo registro en la tabla imProvincia
   * @param {Object} data - Datos del registro a crear
   * @param {number} data.Valor - Identificador de la provincia
   * @param {string} data.LetraProvincia - Código de letra de la provincia (3 caracteres)
   * @param {string} data.Descripcion - Descripción/nombre de la provincia
   * @param {string} data.ValorNacionalidad - Código de nacionalidad (2 caracteres)
   * @returns {Promise<Object>} Promesa con el registro creado
   */
  createProvincia: async (data) => {
    try {
      // Validaciones básicas
      if (!data.Valor || !data.LetraProvincia || !data.Descripcion || !data.ValorNacionalidad) {
        throw new Error('Todos los campos son obligatorios');
      }

      if (data.LetraProvincia.length > 3) {
        throw new Error('El código de letra no puede tener más de 3 caracteres');
      }

      if (data.Descripcion.length > 40) {
        throw new Error('La descripción no puede tener más de 40 caracteres');
      }

      if (data.ValorNacionalidad.length > 2) {
        throw new Error('El código de nacionalidad no puede tener más de 2 caracteres');
      }

      // Comprueba si ya existe una provincia con ese valor
      const provinciaExistente = await provinciaService.getProvincia(data.Valor);
      if (provinciaExistente) {
        throw new Error(`Ya existe una provincia con el valor ${data.Valor}`);
      }

      // Inserta la nueva provincia
      const query = `
        INSERT INTO imProvincia (Valor, LetraProvincia, Descripcion, ValorNacionalidad)
        VALUES (?, ?, ?, ?)
      `;

      await executeQuery(query, [
        data.Valor, 
        data.LetraProvincia, 
        data.Descripcion, 
        data.ValorNacionalidad
      ]);

      return data;
    } catch (error) {
      console.error('Error en el servicio de provincias:', error);
      throw new Error(error.message || 'Error al crear la provincia');
    }
  },

  /**
   * Actualiza un registro existente en la tabla imProvincia
   * @param {number} valor - Identificador de la provincia a actualizar
   * @param {Object} data - Datos actualizados
   * @param {string} [data.LetraProvincia] - Nuevo código de letra
   * @param {string} [data.Descripcion] - Nueva descripción
   * @param {string} [data.ValorNacionalidad] - Nuevo código de nacionalidad
   * @returns {Promise<Object>} Promesa con el registro actualizado
   */
  updateProvincia: async (valor, data) => {
    try {
      // Validaciones básicas
      if (!valor) {
        throw new Error('El valor de la provincia es obligatorio');
      }

      if (data.LetraProvincia && data.LetraProvincia.length > 3) {
        throw new Error('El código de letra no puede tener más de 3 caracteres');
      }

      if (data.Descripcion && data.Descripcion.length > 40) {
        throw new Error('La descripción no puede tener más de 40 caracteres');
      }

      if (data.ValorNacionalidad && data.ValorNacionalidad.length > 2) {
        throw new Error('El código de nacionalidad no puede tener más de 2 caracteres');
      }

      // Comprueba si existe la provincia
      const provinciaExistente = await provinciaService.getProvincia(valor);
      if (!provinciaExistente) {
        throw new Error(`No existe una provincia con el valor ${valor}`);
      }

      // Construye la consulta dinámicamente basada en los campos proporcionados
      let updateFields = [];
      let queryParams = [];

      if (data.LetraProvincia !== undefined) {
        updateFields.push('LetraProvincia = ?');
        queryParams.push(data.LetraProvincia);
      }

      if (data.Descripcion !== undefined) {
        updateFields.push('Descripcion = ?');
        queryParams.push(data.Descripcion);
      }

      if (data.ValorNacionalidad !== undefined) {
        updateFields.push('ValorNacionalidad = ?');
        queryParams.push(data.ValorNacionalidad);
      }

      // Si no hay campos para actualizar
      if (updateFields.length === 0) {
        throw new Error('No se proporcionaron campos para actualizar');
      }

      // Construye la consulta
      const query = `
        UPDATE imProvincia
        SET ${updateFields.join(', ')}
        WHERE Valor = ?
      `;

      queryParams.push(valor); // Añade el valor al final para el WHERE

      await executeQuery(query, queryParams);

      return {
        Valor: valor,
        ...data
      };
    } catch (error) {
      console.error(`Error al actualizar provincia con valor ${valor}:`, error);
      throw new Error(error.message || `Error al actualizar la provincia con valor ${valor}`);
    }
  },

  /**
   * Elimina un registro de la tabla imProvincia
   * @param {number} valor - Valor de la provincia a eliminar
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  deleteProvincia: async (valor) => {
    try {
      // Comprueba si existe la provincia
      const provinciaExistente = await provinciaService.getProvincia(valor);
      if (!provinciaExistente) {
        throw new Error(`No existe una provincia con el valor ${valor}`);
      }

      // Elimina la provincia
      const query = `
        DELETE FROM imProvincia
        WHERE Valor = ?
      `;

      await executeQuery(query, [valor]);

      return true;
    } catch (error) {
      console.error(`Error al eliminar provincia con valor ${valor}:`, error);
      throw new Error(error.message || `Error al eliminar la provincia con valor ${valor}`);
    }
  }
};

module.exports = provinciaService;
