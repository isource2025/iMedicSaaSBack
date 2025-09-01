const catalogsService = require('../services/catalogs.service');
const diagnosticosService = require('../services/diagnosticos.service');

/**
 * Controlador para gestionar los catálogos del sistema
 */
const catalogsController = {
  /**
   * Obtiene las disposiciones de egreso desde la tabla imdisposicionegreso
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getDisposicionesEgreso: async (req, res) => {
    try {
      const data = await catalogsService.getDisposicionesEgreso();
      
      res.json({
        success: true,
        data,
        message: 'Disposiciones de egreso obtenidas correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de disposiciones de egreso:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener disposiciones de egreso'
      });
    }
  },

  /**
   * Obtiene todos los diagnósticos CIE10 de la tabla imdiagnosticos
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getDiagnosticosCie10: async (req, res) => {
    try {
      const data = await diagnosticosService.obtenerDiagnosticosCie10();
      
      res.json({
        success: true,
        data,
        message: 'Diagnósticos CIE10 obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de diagnósticos CIE10:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener diagnósticos CIE10'
      });
    }
  },

  /**
   * Busca diagnósticos CIE10 que coincidan con un término de búsqueda
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  buscarDiagnosticosCie10: async (req, res) => {
    try {
      const { termino } = req.query;
      
      if (!termino) {
        return res.status(400).json({
          success: false,
          data: [],
          message: 'Se requiere un término de búsqueda'
        });
      }
      
      const data = await diagnosticosService.buscarDiagnosticosCie10(termino);
      
      res.json({
        success: true,
        data,
        message: `Se encontraron ${data.length} diagnósticos CIE10`
      });
    } catch (error) {
      console.error('Error en controlador de búsqueda de diagnósticos CIE10:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al buscar diagnósticos CIE10'
      });
    }
  },

  /**
   * Obtiene un diagnóstico CIE10 por su ID
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */
  getDiagnosticoPorId: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'Se requiere un ID de diagnóstico'
        });
      }
      
      const diagnostico = await diagnosticosService.obtenerDiagnosticoPorId(id);
      
      if (!diagnostico) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró diagnóstico con ID ${id}`
        });
      }
      
      res.json({
        success: true,
        data: diagnostico,
        message: 'Diagnóstico CIE10 obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en controlador de diagnóstico por ID:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener diagnóstico CIE10'
      });
    }
  }
};

module.exports = catalogsController;
