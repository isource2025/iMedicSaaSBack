const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const sectoresController = require('../controllers/sectores.controller');

router.use(requireAuth, requireTenant);

router.get('/', sectoresController.obtenerSectores);
router.get('/servicios-medicos', sectoresController.obtenerServicios);
router.post(
	'/servicios-medicos',
	requirePermiso('CONFIGURACION.SECTORES.CREAR'),
	sectoresController.crearServicio,
);
router.put(
	'/servicios-medicos/:valor',
	requirePermiso('CONFIGURACION.SECTORES.EDITAR'),
	sectoresController.actualizarServicio,
);

router.post('/', requirePermiso('CONFIGURACION.SECTORES.CREAR'), sectoresController.crearSector);
router.put('/:valor', requirePermiso('CONFIGURACION.SECTORES.EDITAR'), sectoresController.actualizarSector);

module.exports = router;
