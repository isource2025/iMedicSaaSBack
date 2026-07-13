const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { loginLimiter, authGeneralLimiter } = require('../middlewares/rateLimit.middleware');
const { geoBlockAuth } = require('../middlewares/geoBlock.middleware');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(authGeneralLimiter);

router.post('/login', geoBlockAuth, loginLimiter, authController.inicioSesion);
router.post('/logout', authController.cerrarSesion);
router.post('/refresh', authController.refrescarSesion);
router.get('/me', requireAuth, authController.sesionActual);

router.get('/sectores', requireAuth, authController.obtenerSectores);

/** Deshabilitados: enumeración de usuarios sin contraseña */
router.get('/sectores/:username', authController.obtenerSectoresPorUsuario);
router.get('/empresas/:username', authController.obtenerEmpresasPorUsuario);

/** Panel Super Admin — geo-blocking y configuración de sesión */
router.get(
	'/seguridad/config',
	requireAuth,
	requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'),
	authController.obtenerConfigSeguridad,
);
router.put(
	'/seguridad/config',
	requireAuth,
	requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'),
	authController.actualizarConfigSeguridad,
);
router.get(
	'/seguridad/paises',
	requireAuth,
	requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'),
	authController.listarPaisesPermitidos,
);
router.post(
	'/seguridad/paises',
	requireAuth,
	requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'),
	authController.guardarPaisPermitido,
);
router.patch(
	'/seguridad/paises/:codigo',
	requireAuth,
	requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'),
	authController.togglePaisPermitido,
);

module.exports = router;
