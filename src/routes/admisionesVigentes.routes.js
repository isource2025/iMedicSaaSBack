const express = require('express');

const admisionesVigentesService = require('../services/admisionesVigentes.service');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { statusDeError } = require('../utils/httpError');

const router = express.Router();

router.use(requireTenant);

router.get('/', requirePermiso('INTERNACION.CAMAS.VER'), async (req, res) => {
	try {
		const data = await admisionesVigentesService.listar({ sector: req.query.sector });
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al listar admisiones vigentes:', error);
		res.status(error?.statusCode || statusDeError(error)).json({
			success: false,
			message: error?.message || 'Error al listar admisiones vigentes',
		});
	}
});

module.exports = router;
