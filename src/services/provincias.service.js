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
          p.Valor as valor, 
          p.Descripcion as descripcion,
          n.Descripcion as nacionalidad
        FROM 
          imProvincia as p
        INNER JOIN imNacionalidad as n ON n.Valor = p.ValorNacionalidad
        WHERE
            p.LetraProvincia = @p0
        ORDER BY 
          p.Descripcion
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