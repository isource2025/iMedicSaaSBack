const bedsService = require('../services/beds.service');

const obtenerCamas = async (req, res) => {
  try {
    const camas = await bedsService.obtenerCamas();
    res.json({ success: true, data: camas });
  } catch (error) {
    console.error('Error al obtener camas:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener las camas' });
  }
};

const obtenerCamaPorId = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, mensaje: 'ID inválido' });
    }

    const cama = await bedsService.obtenerCamaPorId(id);
    if (!cama) {
      return res.status(404).json({ success: false, mensaje: 'Cama no encontrada' });
    }

    res.json({ success: true, data: cama });
  } catch (error) {
    console.error('Error al obtener cama:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener la cama' });
  }
};

const actualizarEstadoCama = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { estado } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, mensaje: 'ID inválido' });
    }

    const estadosValidos = ['disponible', 'ocupada', 'mantenimiento'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ success: false, mensaje: 'Estado no válido' });
    }

    const camaActualizada = await bedsService.actualizarEstadoCama(id, estado);
    if (!camaActualizada) {
      return res.status(404).json({ success: false, mensaje: 'Cama no encontrada' });
    }

    res.json({ success: true, data: camaActualizada });
  } catch (error) {
    console.error('Error al actualizar estado de cama:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar el estado de la cama' });
  }
};

module.exports = {
  obtenerCamas,
  obtenerCamaPorId,
  actualizarEstadoCama,
};
