const { executeQuery } = require('../models/db');

const ProvinciasService = {
    /**
   * Obtiene todos los registros de la tabla Localidades
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */

    getProvinciaPorLetra: async (letraProvincia) => {
    try {
      const query = `
        SELECT 
          Valor as valor, 
          Descripcion as descripcion
        FROM 
          imProvincia 
        WHERE
            LetraProvincia = @p0
        ORDER BY 
          Descripcion
      `;
      
      const result = await executeQuery(query, [
        { value: letraProvincia }
      ]);
      return result || [];
    } catch (error) {
      console.error('Error al obtener la provincia:', error);
      throw error;
    }
  },
}

module.exports = ProvinciasService;