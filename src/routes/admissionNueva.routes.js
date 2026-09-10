const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const controller = require('../controllers/admissionNueva.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { restoreTenantFromRequest } = require('../context/tenantContext');
const { fixMulterFile } = require('../utils/fileNameEncoding');

const UPLOAD_TMP = path.join(__dirname, '..', '..', 'uploads', 'requisitos');

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		fs.mkdir(UPLOAD_TMP, { recursive: true }, (err) => cb(err, UPLOAD_TMP));
	},
	filename: (req, file, cb) => {
		const sufijo = Date.now() + '-' + Math.round(Math.random() * 1e9).toString(36);
		cb(null, sufijo + (path.extname(file.originalname) || '.jpg').toLowerCase());
	},
});

const upload = multer({
	storage,
	limits: { fileSize: 25 * 1024 * 1024 },
	fileFilter: (req, file, cb) => {
		fixMulterFile(file);
		const permitidos = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
		if (permitidos.includes(file.mimetype)) return cb(null, true);
		cb(new Error('Solo se permiten imágenes (JPG, PNG, GIF) o PDF'));
	},
});

const router = express.Router();

router.use(requireTenant);

router.get('/catalogos', requirePermiso('ADMISION.NUEVA.CREAR'), controller.catalogos);
router.get('/requisitos', requirePermiso('ADMISION.NUEVA.CREAR'), controller.requisitosCatalogo);
router.get(
	'/requisitos/cobertura/:cliente',
	requirePermiso('ADMISION.NUEVA.CREAR'),
	controller.requisitosCobertura,
);
router.post('/', requirePermiso('ADMISION.NUEVA.CREAR'), controller.crear);
router.get(
	'/:numeroVisita/requisitos',
	requirePermiso('ADMISION.NUEVA.CREAR'),
	controller.requisitosVisita,
);
router.post(
	'/:numeroVisita/requisitos',
	requirePermiso('ADMISION.NUEVA.CREAR'),
	controller.agregarRequisito,
);
router.delete(
	'/:numeroVisita/requisitos/:valor',
	requirePermiso('ADMISION.NUEVA.CREAR'),
	controller.quitarRequisito,
);
router.post(
	'/:numeroVisita/requisitos/:valor/archivo',
	requirePermiso('ADMISION.NUEVA.CREAR'),
	upload.single('archivo'),
	restoreTenantFromRequest,
	controller.subirArchivoRequisito,
);

module.exports = router;
