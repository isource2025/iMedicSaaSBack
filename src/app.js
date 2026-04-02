/**
 * Configuración principal de la aplicación Express
 * @module app
 */
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { configureCors } = require('./middlewares/cors.middleware'); // ✅ ACTIVADO
// Importar middlewares
// const { configureCors } = require('./middlewares/cors.middleware');

// Importar rutas
const authRoutes = require('./routes/auth.routes');
const bedsRoutes = require('./routes/beds.routes');
const patientsRoutes = require('./routes/patients.routes');
const indicacionesRoutes = require('./routes/indicaciones.routes');
const evolucionesRoutes = require('./routes/evoluciones.routes');
const indicadoresRoutes = require('./routes/indicadores.routes');
const empresaRoutes = require('./routes/empresa.routes');
const catalogsRoutes = require('./routes/catalogs.routes');
const provinciaRoutes = require('./routes/provincias.routes');
const localidadesRoutes = require('./routes/localidades.routes');
const sexoRoutes = require('./routes/sexo.routes');
const localidadRoutes = require('./routes/localidad.routes');
const opcGrdRoutes = require('./routes/opcGrd.routes');
const renaperRoutes = require('./routes/renaper.routes');
// Catálogos individuales
const razaRoutes = require('./routes/raza.routes');
const idiomasISORoutes = require('./routes/idiomasISO.routes');
const religionRoutes = require('./routes/religion.routes');
const grupoEtnicoRoutes = require('./routes/grupoEtnico.routes');
const estadoMilitarRoutes = require('./routes/estadoMilitar.routes');
const dadorOrganosRoutes = require('./routes/dadorOrganos.routes');
const coberturaRoutes = require('./routes/cobertura.routes');
const visitaMovimientosRoutes = require('./routes/visitaMovimientos.routes');
const estadosCivilesRoutes = require('./routes/estadoCivil.routes.js');
const medicacionControlRoutes = require('./routes/medicacionControl.routes');
const controlesFrecuentesRoutes = require('./routes/controlesFrecuentes.routes');
const evolucionEnfermeriaRoutes = require('./routes/evolucionEnfermeria.routes');
const actualizacionRoutes = require('./routes/actualizacion.routes');
const hcIngresoRoutes = require('./routes/hcIngreso.routes');
const hciRoutes = require('./routes/hci.routes');
const adjuntosRoutes = require('./routes/adjuntos.routes');
const signosVitalesRoutes = require('./routes/signosVitales.routes');
const usersRoutes = require('./routes/users.routes');
const laboratoriosRoutes = require('./routes/laboratorios.routes');
const sectoresRoutes = require('./routes/sectores.routes');

// Importar conexión a la base de datos
const { connectDB } = require('./config/database');

// Cargar variables de entorno
dotenv.config();

// Inicializar la aplicación Express
const app = express();

// Inicializar conexión a la base de datos
connectDB()
	.then(() => {
		console.log('Base de datos conectada correctamente');
	})
	.catch((err) => {
		console.error('Error de conexión a la base de datos:', err.message);
		// No finalizamos el proceso para que el servidor siga funcionando
		// incluso si la base de datos no está disponible inicialmente
	});

// Configurar middlewares
configureCors(app); // Configuración CORS
//Permitir solo desde tu Frontend (opcion recomendada)
app.use(cors());

app.use(express.json()); // Parseo de JSON
// Soporte para formularios multipart (lo maneja multer en las rutas específicas)

// Asegurar carpetas de uploads
const uploadsDir = path.join(__dirname, '..', 'uploads');
const patientPhotosDir = path.join(uploadsDir, 'patient-photos');
for (const dir of [uploadsDir, patientPhotosDir]) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
// Rutas estáticas (compatibilidad + nueva ruta "segura")
app.use('/uploads', express.static(uploadsDir)); // legado
app.use('/media/patients', express.static(patientPhotosDir));

// Configurar rutas
app.use('/api/auth', authRoutes);
app.use('/api/beds', bedsRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/indicaciones', indicacionesRoutes);
app.use('/api/evoluciones', evolucionesRoutes);
app.use('/api/indicadores', indicadoresRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/catalogs', catalogsRoutes);
app.use('/api/provincias', provinciaRoutes);
app.use('/api/sexo', sexoRoutes);

app.use('/api/localidad', localidadRoutes);
app.use('/api/raza', razaRoutes);
app.use('/api/idiomas-iso', idiomasISORoutes);
app.use('/api/religion', religionRoutes);
app.use('/api/grupo-etnico', grupoEtnicoRoutes);
app.use('/api/estado-militar', estadoMilitarRoutes);
app.use('/api/dador-organos', dadorOrganosRoutes);
app.use('/api/admin/opcgrd', opcGrdRoutes); // Ruta protegida para administradores
app.use('/api/renaper', renaperRoutes);
app.use('/api/cobertura', coberturaRoutes);
app.use('/api/visita-movimientos', visitaMovimientosRoutes);
app.use('/api/estados-civiles', estadosCivilesRoutes);
app.use('/api/medicacion-control', medicacionControlRoutes);
app.use('/api/controles-frecuentes', controlesFrecuentesRoutes);
app.use('/api/evolucion-enfermeria', evolucionEnfermeriaRoutes);
app.use('/api/actualizacion', actualizacionRoutes);
app.use('/api/hc-ingreso', hcIngresoRoutes);
app.use('/api/hci', hciRoutes);
app.use('/api/adjuntos', adjuntosRoutes);
app.use('/api/signos-vitales', signosVitalesRoutes);
app.use('/api/admin/users', usersRoutes);
app.use('/api/laboratorios', laboratoriosRoutes);
app.use('/api/sectores', sectoresRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
	res.send('API de iMedicWS funcionando correctamente');
});

// Middleware para manejo de errores global
app.use((err, req, res, next) => {
	console.error('Error en la aplicación:', err.message);
	if (process.env.NODE_ENV === 'development') {
		console.error('Stack:', err.stack);
	}
	res.status(500).json({
		success: false,
		mensaje: 'Error interno del servidor',
		error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno',
	});
});

// Middleware para rutas no encontradas
app.use((req, res) => {
	res.status(404).json({
		success: false,
		mensaje: 'Ruta no encontrada',
	});
});

module.exports = app;
