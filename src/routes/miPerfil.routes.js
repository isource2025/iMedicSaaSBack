const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const miPerfilController = require('../controllers/miPerfil.controller');
const uploadFoto = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 3 * 1024 * 1024 },
});

router.get('/', requireAuth, miPerfilController.obtenerPerfil);
router.put('/', requireAuth, miPerfilController.actualizarPerfil);
router.get('/foto', requireAuth, miPerfilController.obtenerFotoPerfil);
router.put('/foto', requireAuth, uploadFoto.single('archivo'), miPerfilController.actualizarFotoPerfil);
router.delete('/foto', requireAuth, miPerfilController.eliminarFotoPerfil);
router.get('/produccion-mes/convenios', requireAuth, miPerfilController.listarConveniosProduccion);
router.get('/produccion-mes', requireAuth, miPerfilController.obtenerProduccionMes);

module.exports = router;
