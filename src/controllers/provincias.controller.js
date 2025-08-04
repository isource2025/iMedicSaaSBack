const ProvinciasService = require('../services/provincias.service');

const ProvinciasController = {
   /**
   * Obtiene un registro de la tabla localidades por el ID de la provincia
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */

    getProvinciaPorLetra: async (req, res) => {
        try {
            const { letraProvincia } = req.params;

            if (!letraProvincia) {
                return res.status(400).json({
                    success: false,
                    data: null,
                    message: 'Se requiere una letra de provincia'
                });
            }

            const data = await ProvinciasService.getProvinciaPorLetra(letraProvincia);
            
            res.json({
                success: true,
                data,
                message: 'Registro de provincia obtenido correctamente'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                data: [],
                message: error.message || 'Error al obtener el registro de la provincia'
            });
        }
    },
}

module.exports = ProvinciasController;