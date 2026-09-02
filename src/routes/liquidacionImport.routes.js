const express = require('express');
const multer = require('multer');
const router = express.Router();
const liquidacionImportController = require('../controllers/liquidacionImport.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { restoreTenantFromRequest } = require('../context/tenantContext');

const EXTENSIONES = /\.(xlsx|xlsm|xls)$/i;

const uploadExcel = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024 },
	fileFilter: (req, file, cb) => {
		if (!EXTENSIONES.test(String(file.originalname || ''))) {
			return cb(new Error('El archivo tiene que ser un Excel (.xlsx, .xlsm o .xls)'));
		}
		cb(null, true);
	},
});

router.use(requireTenant);

// La importación reescribe importes de facturación: la habilita GESTIONAR de
// Liquidaciones, que tienen ADMIN, SUPER_ADMIN y ADMINISTRATIVO.
const soloLiquidaciones = requirePermiso('FACTURACION.LIQUIDACIONES.GESTIONAR');
const puedeVer = requirePermiso('FACTURACION.LIQUIDACIONES.VER');

/** Multer/busboy corta el AsyncLocalStorage: hay que volver a entrar al tenant. */
const conArchivo = [
	soloLiquidaciones,
	uploadExcel.single('archivo'),
	restoreTenantFromRequest,
];

router.post(
	'/importe-liquidado/preview',
	conArchivo,
	liquidacionImportController.previsualizar,
);
router.post(
	'/importe-liquidado/aplicar',
	conArchivo,
	liquidacionImportController.aplicar,
);

router.get('/importaciones', puedeVer, liquidacionImportController.listarImportaciones);
router.get('/importaciones/:id', puedeVer, liquidacionImportController.obtenerImportacion);
router.post(
	'/importaciones/:id/revertir',
	soloLiquidaciones,
	liquidacionImportController.revertir,
);

/** Errores de multer (tamaño, extensión) como 400 y no como 500. */
router.use((err, req, res, next) => {
	if (!err) return next();
	const esLimite = err.code === 'LIMIT_FILE_SIZE';
	return res.status(400).json({
		success: false,
		mensaje: esLimite ? 'El archivo supera los 10 MB' : err.message,
	});
});

module.exports = router;
