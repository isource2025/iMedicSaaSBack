const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');
const multer = require('multer');
const path = require('path');
const visitaMovimientosController = require('../controllers/visitaMovimientos.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, path.join(__dirname, '..', '..', 'uploads', 'patient-photos'));
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9).toString(36);
		const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
		cb(null, uniqueSuffix + ext);
	},
});

const upload = multer({
	storage,
	fileFilter: (req, file, cb) => {
		if (!file.mimetype.startsWith('image/')) {
			return cb(new Error('Solo se permiten imágenes'));
		}
		cb(null, true);
	},
	limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(requireTenant);

router.get(
	'/visitas/:numeroVisita/movimientos/ultimo',
	requirePermiso('INTERNACION.MOVIMIENTOS.VER'),
	visitaMovimientosController.obtenerUltimoMovimientoVisita,
);
router.put(
	'/visitas/:numeroVisita/movimientos/ultimo',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	visitaMovimientosController.actualizarUltimoMovimientoVisita,
);
router.get(
	'/visitas/:numeroVisita/movimientos',
	requirePermiso('INTERNACION.MOVIMIENTOS.VER'),
	visitaMovimientosController.obtenerMovimientosVisita,
);
router.put(
	'/visitas/:numeroVisita/mover-cama',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	visitaMovimientosController.moverPacienteACamaVacia,
);
router.put(
	'/visitas/:numeroVisita1/intercambiar-cama/:numeroVisita2',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	visitaMovimientosController.intercambiarCamasPacientes,
);
router.post(
	'/visitas/egreso',
	requirePermiso('INTERNACION.MOVIMIENTOS.GESTIONAR'),
	patientsController.registrarEgresoPaciente,
);

router.get('/visitas/:numeroVisita', requirePermiso('ADMISION.VIGENTES.VER'), patientsController.obtenerVisitaPorNumero);
router.get('/', requirePermiso('ADMISION.PACIENTES.VER'), patientsController.obtenerPacientes);
router.get('/search', requirePermiso('ADMISION.PACIENTES.VER'), patientsController.buscarPacientes);
router.get('/reference-tables', requirePermiso('ADMISION.PACIENTES.VER'), patientsController.obtenerTablasReferencia);
router.get('/catalogo-laboral', requirePermiso('ADMISION.PACIENTES.VER'), patientsController.obtenerCatalogosLaborales);
router.get('/:id', requirePermiso('ADMISION.PACIENTES.VER'), patientsController.obtenerPacientePorId);
router.post('/', requirePermiso('ADMISION.PACIENTES.CREAR'), upload.single('Foto'), patientsController.crearPaciente);
router.put('/:id', requirePermiso('ADMISION.PACIENTES.EDITAR'), upload.single('Foto'), patientsController.actualizarPaciente);
router.delete('/:id', requirePermiso('ADMISION.PACIENTES.ELIMINAR'), patientsController.eliminarPaciente);

module.exports = router;
