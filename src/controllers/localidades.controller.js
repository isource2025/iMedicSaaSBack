const LocalidadesService = require('../services/localidades.service');

const LocalidadesController = {
   /**
   * Obtiene un registro de la tabla localidades por el ID de la provincia
   * @param {Object} req - Objeto de solicitud HTTP
   * @param {Object} res - Objeto de respuesta HTTP
   */

    getLocalidades: async (req, res) => {
        try {
            const { idProvincia } = req.params;
        
            if (!idProvincia) {
                return res.status(400).json({
                    success: false,
                    data: null,
                    message: 'Se requiere un ID de provincia'
                });
            }

            const data = await LocalidadesService.getLocalidades(idProvincia);
            
            res.json({
                success: true,
                data,
                message: 'Registros de localidades obtenidos correctamente'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                data: [],
                message: error.message || 'Error al obtener registros de localidades'
            });
        }
    },
}

module.exports = LocalidadesController;