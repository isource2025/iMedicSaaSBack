const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');

router.use(requireTenant);

router.get('/', requirePermiso('CONFIGURACION.USUARIOS.VER'), usersController.obtenerUsuarios);
router.get('/:id', requirePermiso('CONFIGURACION.USUARIOS.VER'), usersController.obtenerUsuario);
router.post('/', requirePermiso('CONFIGURACION.USUARIOS.CREAR'), usersController.crearUsuario);
router.put('/:id', requirePermiso('CONFIGURACION.USUARIOS.EDITAR'), usersController.actualizarUsuario);
router.put('/:id/password', requirePermiso('CONFIGURACION.USUARIOS.EDITAR'), usersController.cambiarPassword);
router.post('/:id/sectores', requirePermiso('CONFIGURACION.USUARIOS.EDITAR'), usersController.asignarSector);
router.delete(
	'/:id/sectores/:idSector',
	requirePermiso('CONFIGURACION.USUARIOS.EDITAR'),
	usersController.quitarSector,
);

module.exports = router;
