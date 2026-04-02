const sectoresService = require('../services/sectores.service');

/**
 * Obtiene todos los sectores activos
 * GET /api/sectores
 */
const obtenerSectores = async (req, res) => {
  try {
    const sectores = await sectoresService.obtenerSectores();
    
    res.json({
      success: true,
      data: sectores,
      total: sectores.length
    });
  } catch (error) {
    console.error('Error en obtenerSectores:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener sectores'
    });
  }
};

module.exports = {
  obtenerSectores
};
