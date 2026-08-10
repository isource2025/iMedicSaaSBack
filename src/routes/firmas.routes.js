const express = require('express');
const router = express.Router();
const personalService = require('../services/personal.service');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');

/**
 * Firmas para PDF clínicos.
 * Cualquier usuario autenticado del tenant (no requiere CONFIGURACION.PERSONAL).
 */
router.use(requireAuth, requireTenant);

router.get('/personal/:key', async (req, res) => {
	const key = Number(req.params.key);
	if (!Number.isFinite(key) || key <= 0) {
		return res.status(400).json({ success: false, mensaje: 'Clave inválida' });
	}
	try {
		const data = await personalService.obtenerFirmaPorMatricula(key);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[firmas.personal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener firma' });
	}
});

module.exports = router;
