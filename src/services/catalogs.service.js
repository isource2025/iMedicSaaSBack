const { executeQuery } = require('../models/db');

// Disposiciones por defecto en caso de que la tabla no exista
const DEFAULT_DISPOSICIONES = [
  { valor: 'ALTA', descripcion: 'Alta médica' },
  { valor: 'TRASL', descripcion: 'Traslado' },
  { valor: 'DEFUN', descripcion: 'Defunción' },
  { valor: 'VOLUN', descripcion: 'Alta voluntaria' }
];

/**
 * Servicio para gestionar los catálogos del sistema
 */
const catalogsService = {
  /**
   * Obtiene los registros de la tabla imdisposicionegreso
   * @returns {Promise} Promesa con los resultados de la consulta
   */
  getDisposicionesEgreso: async () => {
    try {
      // Intentar consultar la tabla imdisposicionegreso
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(50)) AS valor, 
          descripcion AS descripcion 
        FROM 
          imdisposicionegreso 
        ORDER BY 
          descripcion
      `;
      
      console.log('Ejecutando consulta:', query);
      const result = await executeQuery(query);
      
      if (result && result.length > 0) {
        // Convertir cualquier valor numérico a string
        const formattedResults = result.map(item => ({
          valor: String(item.valor), // Asegurar que valor sea string
          descripcion: item.descripcion
        }));
        
        console.log(`Disposiciones de egreso encontradas: ${formattedResults.length}`);
        return formattedResults;
      }
      
      console.log('No se encontraron datos en imdisposicionegreso, usando valores por defecto');
      return DEFAULT_DISPOSICIONES;
    } catch (error) {
      console.error('Error al consultar disposiciones de egreso:', error);
      
      // Si hay un error, es probable que la tabla no exista, usar valores por defecto
      console.log('Usando valores por defecto debido al error');
      return DEFAULT_DISPOSICIONES;
    }
  }
};

module.exports = catalogsService;
