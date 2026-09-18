const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar la tabla imLocalidades
 */
const localidadService = {
  /**
   * Obtiene registros de la tabla imLocalidades con paginación y búsqueda
   * @param {number} page - Número de página (por defecto 1)
   * @param {number} limit - Límite de registros por página (por defecto 50, máximo 200)
   * @param {string} search - Término de búsqueda opcional
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */
  getLocalidades: async (page = 1, limit = 50, search = '') => {
    try {
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (parsedPage - 1) * parsedLimit;
      
      let whereClause = '';
      const params = [];
      
      if (search && search.trim()) {
        whereClause = 'WHERE Localidad LIKE @p0 OR NombreLocalidad LIKE @p0';
        params.push({ value: `%${search.trim()}%` });
      }
      
      const offsetParam = `@p${params.length}`;
      const limitParam = `@p${params.length + 1}`;
      
      const query = `
        SELECT 
          Valor, 
          NombreLocalidad,
          Localidad,
          CodigoPostal,
          ValorProvincia
        FROM 
          imLocalidades 
        ${whereClause}
        ORDER BY 
          Localidad
        OFFSET ${offsetParam} ROWS FETCH NEXT ${limitParam} ROWS ONLY
      `;
      
      params.push(
        { value: offset },
        { value: parsedLimit }
      );
      
      const result = await executeQuery(query, params);
      return result || [];
    } catch (error) {
      console.error('Error al obtener localidades:', error);
      throw new Error('Error al obtener localidades: ' + error.message);
    }
  },

  /**
   * Cuenta el total de localidades (con filtro opcional)
   * @param {string} search - Término de búsqueda opcional
   * @returns {Promise<number>} Promesa con el conteo total
   */
  contarLocalidades: async (search = '') => {
    try {
      let whereClause = '';
      const params = [];
      
      if (search && search.trim()) {
        whereClause = 'WHERE Localidad LIKE @p0 OR NombreLocalidad LIKE @p0';
        params.push({ value: `%${search.trim()}%` });
      }
      
      const query = `SELECT COUNT(*) as total FROM imLocalidades ${whereClause}`;
      const result = await executeQuery(query, params);
      return result[0]?.total || 0;
    } catch (error) {
      console.error('Error al contar localidades:', error);
      throw new Error('Error al contar localidades: ' + error.message);
    }
  },

  /**
   * Obtiene un registro de la tabla imLocalidades por su valor
   * @param {string} valor - Valor de la localidad a buscar
   * @returns {Promise<Object|null>} Promesa con el resultado de la consulta
   */
  getLocalidadByValor: async (valor) => {
    try {
      const query = `
        SELECT 
          Valor, 
          NombreLocalidad,
          Localidad,
          CodigoPostal,
          ValorProvincia
        FROM 
          imLocalidades 
        WHERE 
          Valor = @p0
      `;
      
      const result = await executeQuery(query, [{ value: valor }]);
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener localidad con valor ${valor}:`, error);
      throw new Error(`Error al obtener localidad: ${error.message}`);
    }
  },

  /**
   * Obtiene un registro de la tabla imLocalidades por su descripción
   * @param {string} localidad - Valor de la localidad a buscar
   * @returns {Promise<Object|null>} Promesa con el resultado de la consulta
   */

  getLocalidadByDescripcion: async (localidad) => {
    try {
      const query = `
        SELECT 
          Valor,
          ValorProvincia
        FROM 
          imLocalidades 
        WHERE 
          NombreLocalidad = '${localidad}'
      `;
      
      const result = await executeQuery(query, [localidad]);
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener localidad con descripcion ${localidad}:`, error);
      throw new Error(`Error al obtener localidad: ${error.message}`);
    }
  },

  /**
   * Crea un nuevo registro en la tabla imLocalidades
   * @param {Object} data - Datos del registro a crear
   * @param {string} data.valor - Valor de la localidad
   * @param {string} data.descripcion - Descripción de la localidad
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  createLocalidad: async (data) => {
    try {
      const nombre = String(data.NombreLocalidad || data.descripcion || '').trim();
      const codigoPostal = Number(data.CodigoPostal) || 0;
      const valorProvincia = String(data.ValorProvincia || '').trim();
      if (!nombre) throw new Error('El nombre de la localidad es obligatorio');

      const next = await executeQuery(
        'SELECT ISNULL(MAX(Valor), 0) + 1 AS NextValor FROM imLocalidades',
      );
      const valor = Number(data.Valor) > 0 ? Number(data.Valor) : Number(next[0]?.NextValor) || 1;

      const query = `
        INSERT INTO imLocalidades (Valor, CodigoPostal, NombreLocalidad, Localidad, ValorProvincia)
        VALUES (@p0, @p1, @p2, @p3, @p4)
      `;

      await executeQuery(query, [
        { value: valor, type: 'Int' },
        { value: codigoPostal, type: 'Int' },
        { value: nombre, type: 'VarChar', length: 85 },
        { value: nombre.slice(0, 35), type: 'VarChar', length: 35 },
        { value: valorProvincia, type: 'VarChar', length: 3 },
      ]);
      return true;
    } catch (error) {
      console.error('Error al crear localidad:', error);
      throw new Error('Error al crear localidad: ' + error.message);
    }
  },

  /**
   * Actualiza un registro existente en la tabla imLocalidades
   * @param {string} valor - Valor de la localidad a actualizar
   * @param {Object} data - Datos actualizados
   * @param {string} data.descripcion - Nueva descripción de la localidad
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  updateLocalidad: async (valor, data) => {
    try {
      // Verificar si existe el registro
      const existingRecord = await localidadService.getLocalidadByValor(valor);
      if (!existingRecord) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        UPDATE imLocalidades
        SET CodigoPostal = @p0, NombreLocalidad = @p1, Localidad = @p2, ValorProvincia = @p3
        WHERE Valor = @p4
      `;
      
      const nombre = String(data.NombreLocalidad || data.descripcion || '').trim();
      await executeQuery(query, [
        { value: Number(data.CodigoPostal) || 0, type: 'Int' },
        { value: nombre, type: 'VarChar', length: 85 },
        { value: nombre.slice(0, 35), type: 'VarChar', length: 35 },
        { value: String(data.ValorProvincia || ''), type: 'VarChar', length: 3 },
        { value: Number(valor), type: 'Int' },
      ]);
      return true;
    } catch (error) {
      console.error(`Error al actualizar localidad con valor ${valor}:`, error);
      throw new Error(`Error al actualizar localidad: ${error.message}`);
    }
  },

  /**
   * Elimina un registro de la tabla imLocalidades
   * @param {string} valor - Valor de la localidad a eliminar
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  deleteLocalidad: async (valor) => {
    try {
      // Verificar si existe el registro
      const existingRecord = await localidadService.getLocalidadByValor(valor);
      if (!existingRecord) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        DELETE FROM imLocalidades
        WHERE Valor = @p0
      `;
      
      await executeQuery(query, [{ value: Number(valor), type: 'Int' }]);
      return true;
    } catch (error) {
      console.error(`Error al eliminar localidad con valor ${valor}:`, error);
      throw new Error(`Error al eliminar localidad: ${error.message}`);
    }
  }
};

module.exports = localidadService;
