const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar la tabla imOpcGrd
 */
const opcGrdService = {
  /**
   * Obtiene registros de la tabla imOpcGrd con paginación y búsqueda
   * @param {number} page - Número de página (por defecto 1)
   * @param {number} limit - Límite de registros por página (por defecto 50, máximo 200)
   * @param {string} search - Término de búsqueda opcional
   * @returns {Promise} Promesa con los resultados de la consulta
   */
  getAllOpcGrd: async (page = 1, limit = 50, search = '') => {
    try {
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (parsedPage - 1) * parsedLimit;
      
      let whereClause = '';
      const params = [];
      
      if (search && search.trim()) {
        whereClause = 'WHERE rubro LIKE @p0 OR descripcion LIKE @p0';
        params.push({ value: `%${search.trim()}%` });
      }
      
      const offsetParam = `@p${params.length}`;
      const limitParam = `@p${params.length + 1}`;
      
      const query = `
        SELECT 
          rubro,
          descripcion,
          icono,
          orden
        FROM 
          imOpcGrd 
        ${whereClause}
        ORDER BY 
          rubro, orden
        OFFSET ${offsetParam} ROWS FETCH NEXT ${limitParam} ROWS ONLY
      `;
      
      params.push(
        { value: offset },
        { value: parsedLimit }
      );
      
      console.log('Ejecutando consulta paginada para opciones de grilla');
      const result = await executeQuery(query, params);
      
      if (result && result.length > 0) {
        console.log(`Opciones de grilla encontradas: ${result.length}`);
        return result;
      }
      
      console.log('No se encontraron datos en imOpcGrd');
      return [];
    } catch (error) {
      console.error('Error al consultar opciones de grilla:', error);
      throw error;
    }
  },

  /**
   * Cuenta el total de opciones de grilla (con filtro opcional)
   * @param {string} search - Término de búsqueda opcional
   * @returns {Promise<number>} Promesa con el conteo total
   */
  contarOpcGrd: async (search = '') => {
    try {
      let whereClause = '';
      const params = [];
      
      if (search && search.trim()) {
        whereClause = 'WHERE rubro LIKE @p0 OR descripcion LIKE @p0';
        params.push({ value: `%${search.trim()}%` });
      }
      
      const query = `SELECT COUNT(*) as total FROM imOpcGrd ${whereClause}`;
      const result = await executeQuery(query, params);
      return result[0]?.total || 0;
    } catch (error) {
      console.error('Error al contar opciones de grilla:', error);
      throw new Error('Error al contar opciones de grilla: ' + error.message);
    }
  },

  /**
   * Obtiene un registro específico de la tabla imOpcGrd por su ID
   * @param {number} id - ID de la opción a buscar
   * @returns {Promise} Promesa con el resultado de la consulta
   */
  getOpcGrdById: async (id) => {
    try {
      const query = `
        SELECT 
          rubro,
          descripcion,
          icono,
          orden
        FROM 
          imOpcGrd 
        WHERE 
          rubro = @p0
      `;
      
      const result = await executeQuery(query, [{ value: String(id) }]);
      
      if (result && result.length > 0) {
        console.log(`Opción de grilla encontrada con ID ${id}`);
        return result[0];
      }
      
      console.log(`No se encontró opción de grilla con ID ${id}`);
      return null;
    } catch (error) {
      console.error(`Error al consultar opción de grilla con ID ${id}:`, error);
      throw error;
    }
  },

  /**
   * Crea un nuevo registro en la tabla imOpcGrd
   * @param {Object} opcGrd - Datos de la opción de grilla a crear
   * @returns {Promise} Promesa con el resultado de la consulta
   */
  createOpcGrd: async (opcGrd) => {
    try {
      const { descripcion, usuarioCreacion } = opcGrd;
      const fechaActual = new Date().toISOString().slice(0, 19).replace('T', ' ');
      
      const query = `
        INSERT INTO imOpcGrd (
          descripcion, 
          habilitado, 
          fechaCreacion, 
          usuarioCreacion
        ) VALUES (
          '${descripcion}',
          1,
          '${fechaActual}',
          '${usuarioCreacion}'
        )
      `;
      
      console.log('Ejecutando consulta para crear opción de grilla:', query);
      const result = await executeQuery(query);
      
      if (result && result.insertId) {
        console.log(`Opción de grilla creada con ID ${result.insertId}`);
        return { id: result.insertId, ...opcGrd, habilitado: 1, fechaCreacion: fechaActual };
      }
      
      throw new Error('No se pudo crear la opción de grilla');
    } catch (error) {
      console.error('Error al crear opción de grilla:', error);
      throw error;
    }
  },

  /**
   * Actualiza un registro existente en la tabla imOpcGrd
   * @param {number} id - ID de la opción a actualizar
   * @param {Object} opcGrd - Datos actualizados de la opción de grilla
   * @returns {Promise} Promesa con el resultado de la consulta
   */
  updateOpcGrd: async (id, opcGrd) => {
    try {
      const { descripcion, usuarioModificacion } = opcGrd;
      const fechaActual = new Date().toISOString().slice(0, 19).replace('T', ' ');
      
      const query = `
        UPDATE imOpcGrd SET
          descripcion = '${descripcion}',
          fechaModificacion = '${fechaActual}',
          usuarioModificacion = '${usuarioModificacion}'
        WHERE
          id = ${id}
      `;
      
      console.log(`Ejecutando consulta para actualizar opción de grilla con ID ${id}:`, query);
      const result = await executeQuery(query);
      
      if (result && result.affectedRows > 0) {
        console.log(`Opción de grilla actualizada con ID ${id}`);
        return { id, ...opcGrd, fechaModificacion: fechaActual };
      }
      
      throw new Error(`No se pudo actualizar la opción de grilla con ID ${id}`);
    } catch (error) {
      console.error(`Error al actualizar opción de grilla con ID ${id}:`, error);
      throw error;
    }
  },

  /**
   * Realiza un borrado lógico de un registro en la tabla imOpcGrd
   * @param {number} id - ID de la opción a eliminar
   * @param {string} usuario - Usuario que realiza la eliminación
   * @returns {Promise} Promesa con el resultado de la consulta
   */
  deleteOpcGrd: async (id, usuario) => {
    try {
      const fechaActual = new Date().toISOString().slice(0, 19).replace('T', ' ');
      
      const query = `
        UPDATE imOpcGrd SET
          habilitado = 0,
          fechaModificacion = '${fechaActual}',
          usuarioModificacion = '${usuario}'
        WHERE
          id = ${id}
      `;
      
      console.log(`Ejecutando consulta para eliminar (borrado lógico) opción de grilla con ID ${id}:`, query);
      const result = await executeQuery(query);
      
      if (result && result.affectedRows > 0) {
        console.log(`Opción de grilla eliminada (borrado lógico) con ID ${id}`);
        return true;
      }
      
      throw new Error(`No se pudo eliminar la opción de grilla con ID ${id}`);
    } catch (error) {
      console.error(`Error al eliminar opción de grilla con ID ${id}:`, error);
      throw error;
    }
  }
};

module.exports = opcGrdService;
