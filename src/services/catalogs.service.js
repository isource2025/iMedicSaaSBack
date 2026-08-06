const { executeQuery } = require('../models/db');

// Disposiciones por defecto en caso de que la tabla no exista
const DEFAULT_DISPOSICIONES = [
  { Valor: 1, Descripcion: 'ALTA MEDICA' },
  { Valor: 2, Descripcion: 'DERIVADO' },
  { Valor: 3, Descripcion: 'DEFUNCION' },
  { Valor: 4, Descripcion: 'ALTA VOLUNTARIA' },
];

/**
 * Servicio para gestionar los catálogos del sistema
 */
const catalogsService = {
  /**
   * Obtiene los registros de la tabla imDisposicionEgreso
   * @returns {Promise<Array<{Valor: number, Descripcion: string}>>}
   */
  getDisposicionesEgreso: async () => {
    try {
      const query = `
        SELECT
          Valor,
          Descripcion
        FROM imDisposicionEgreso
        ORDER BY Descripcion
      `;

      const result = await executeQuery(query);

      if (result && result.length > 0) {
        return result.map((item) => ({
          Valor: Number(item.Valor ?? item.valor),
          Descripcion: String(item.Descripcion ?? item.descripcion ?? '').trim(),
        })).filter((item) => Number.isFinite(item.Valor) && item.Descripcion);
      }

      console.log('No se encontraron datos en imDisposicionEgreso, usando valores por defecto');
      return DEFAULT_DISPOSICIONES;
    } catch (error) {
      console.error('Error al consultar disposiciones de egreso:', error);
      return DEFAULT_DISPOSICIONES;
    }
  },

  /**
   * Obtiene los registros de imEstadoAmbulatorio
   * @returns {Promise<Array<{Valor: string, Descripcion: string}>>}
   */
  getEstadosAmbulatorios: async () => {
    const query = `
      SELECT
        LTRIM(RTRIM(ISNULL(Valor, ''))) AS Valor,
        LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion
      FROM dbo.imEstadoAmbulatorio
      ORDER BY Descripcion
    `;
    const result = await executeQuery(query);
    return (result || [])
      .map((item) => ({
        Valor: String(item.Valor ?? item.valor ?? '').trim(),
        Descripcion: String(item.Descripcion ?? item.descripcion ?? '').trim(),
      }))
      .filter((item) => item.Valor || item.Descripcion);
  },
};

module.exports = catalogsService;
