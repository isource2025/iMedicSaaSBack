const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const miPerfilController = require('../controllers/miPerfil.controller');
const uploadFoto = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 3 * 1024 * 1024 },
});

router.use(requireAuth, requireTenant);
router.get('/', miPerfilController.obtenerPerfil);
router.put('/', miPerfilController.actualizarPerfil);
router.get('/foto', miPerfilController.obtenerFotoPerfil);
router.put('/foto', uploadFoto.single('archivo'), miPerfilController.actualizarFotoPerfil);
router.delete('/foto', miPerfilController.eliminarFotoPerfil);
router.get('/produccion-mes/convenios', miPerfilController.listarConveniosProduccion);
router.get('/produccion-mes', miPerfilController.obtenerProduccionMes);

module.exports = router;
