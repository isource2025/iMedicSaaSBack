const renaperService = require('../services/renaper.service');

const getToken = async (req, res) => {
  try {
    const token = await renaperService.getToken();
    res.json({ token });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      mensaje: 'Error al generar el token del renaper',
      error: error.message 
    });
  }
};

const search = async (req, res) => {
    const NumeroDocumento = parseInt(req.params.documento);
    const Sexo = parseInt(req.params.sexo);

    try {
        const persona = await renaperService.search(NumeroDocumento, Sexo);
        res.json({ persona });
    } catch (error) {
        res.status(500).json({ 
        success: false, 
        mensaje: 'Error al buscar a la persona en el renaper',
        error: error.message 
        });
    }
}

module.exports = {
  getToken,
  search
};