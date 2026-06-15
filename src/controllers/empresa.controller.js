/**
 * Controlador para gestionar la información de la empresa
 */
const empresaService = require('../services/empresa.service');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

/**
 * Obtener la información de la empresa
 * @param {Object} req Request
 * @param {Object} res Response
 */
const obtenerInfoEmpresa = async (req, res) => {
  try {
    let idEmpresa = req.idEmpresa ?? req.auth?.idEmpresa ?? null;
    if (!isAuthCentralEnabled()) {
      idEmpresa = idEmpresa ?? req.query.id ?? req.query.idEmpresa ?? null;
    }
    const empresaInfo = await empresaService.obtenerInfoEmpresa(idEmpresa);
    
    res.json({
      success: true,
      data: empresaInfo
    });
  } catch (error) {
    console.error('Error al obtener información de la empresa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de la empresa',
      error: error.message
    });
  }
};

module.exports = {
  obtenerInfoEmpresa
};
