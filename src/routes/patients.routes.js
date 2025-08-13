const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');
const multer = require('multer');
const path = require('path');

// Configuración de almacenamiento para fotos de pacientes
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, path.join(__dirname, '..', '..', 'uploads'));
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
		const ext = path.extname(file.originalname) || '.jpg';
		cb(null, 'paciente-' + uniqueSuffix + ext);
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
	limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
const visitaMovimientosController = require('../controllers/visitaMovimientos.controller');

// IMPORTANTE: El orden de las rutas es crucial
// Las rutas más específicas deben ir antes que las más generales

// Rutas para movimientos de visita (más específicas)
router.get(
	'/visitas/:numeroVisita/movimientos/ultimo',
	visitaMovimientosController.obtenerUltimoMovimientoVisita,
);
router.put(
	'/visitas/:numeroVisita/movimientos/ultimo',
	visitaMovimientosController.actualizarUltimoMovimientoVisita,
);
router.get(
	'/visitas/:numeroVisita/movimientos',
	visitaMovimientosController.obtenerMovimientosVisita,
);

// Ruta para mover un paciente a una nueva cama
router.put(
	'/visitas/:numeroVisita/mover-cama',
	visitaMovimientosController.moverPacienteACamaVacia,
);

// Ruta para intercambiar camas entre dos pacientes
router.put(
	'/visitas/:numeroVisita1/intercambiar-cama/:numeroVisita2',
	visitaMovimientosController.intercambiarCamasPacientes,
);

// Ruta para registrar egreso (específica)
router.post('/visitas/egreso', patientsController.registrarEgresoPaciente);

// Ruta para obtener visita por número (más general)
router.get('/visitas/:numeroVisita', patientsController.obtenerVisitaPorNumero);

// Rutas generales de pacientes
router.get('/', patientsController.obtenerPacientes);
router.get('/search', patientsController.buscarPacientes);

// Obtiene las tablas de referencia (sexo, raza, provincia, etc.)
router.get('/reference-tables', patientsController.obtenerTablasReferencia);
router.get('/:id', patientsController.obtenerPacientePorId);
router.post('/', upload.single('Foto'), patientsController.crearPaciente);
router.put('/:id', upload.single('Foto'), patientsController.actualizarPaciente);
router.delete('/:id', patientsController.eliminarPaciente);

module.exports = router;
