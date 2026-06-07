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
const notificacionesRoutes = require('./routes/notificaciones.routes');
const admissionSearchRoutes = require('./routes/admissionSearch.routes');
const rendicionesRoutes = require('./routes/rendiciones.routes');
const personalRoutes = require('./routes/personal.routes');
const miPerfilRoutes = require('./routes/miPerfil.routes');
const rolesRoutes = require('./routes/roles.routes');
const permisosRoutes = require('./routes/permisos.routes');
const superAdminRoutes = require('./routes/superAdmin.routes');
const agendaConfigRoutes = require('./routes/agendaConfig.routes');
const turnosAdminRoutes = require('./routes/turnosAdmin.routes');
const botIntegrationRoutes = require('./routes/botIntegration.routes');
const botAdminRoutes = require('./routes/botAdmin.routes');
const whatsappWebhookRoutes = require('./routes/whatsappWebhook.routes');

// Importar conexión a la base de datos
const { connectDB, isPlatformSqlConfigured } = require('./config/database');
const { isAuthCentralEnabled } = require('./config/authCentralDb');

// Cargar variables de entorno
dotenv.config();

// Inicializar la aplicación Express
const app = express();

// SQL plataforma: solo precargar pool en modo legacy (sin MySQL auth).
// En Railway/local con AUTH_DB=1 la conexión clínica sale de Empresas por tenant.
if (isPlatformSqlConfigured() && !isAuthCentralEnabled()) {
	connectDB()
		.then(() => {
			console.log('Base de datos plataforma (SQL Server) conectada');
		})
		.catch((err) => {
			console.error('Error de conexión SQL plataforma:', err.message);
		});
} else if (isAuthCentralEnabled()) {
	const { testAuthCentralConnection } = require('./config/authCentralDb');
	testAuthCentralConnection()
		.then(() => console.log('✓ MySQL auth (imPassword / imPersonalEmpresas / Empresas) accesible'))
		.catch((err) => {
			console.error('❌ No se pudo conectar a MySQL auth:', err.message);
		});
}

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
const { apiAuthUnlessPublic } = require('./middlewares/apiAuth.middleware');

app.use('/api/auth', authRoutes);
app.use('/api/webhook/whatsapp', whatsappWebhookRoutes);
// JWT + idEmpresa en contexto (sin esto, /api/beds e indicadores usan DB_* de plataforma y fallan en Railway)
app.use('/api', apiAuthUnlessPublic);

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
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/admission-search', admissionSearchRoutes);
app.use('/api/rendiciones', rendicionesRoutes);
app.use('/api/personal', personalRoutes);
app.use('/api/mi-perfil', miPerfilRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/permisos', permisosRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/agenda', agendaConfigRoutes);
app.use('/api/turnos-admin', turnosAdminRoutes);
app.use('/api/integrations/bot', botIntegrationRoutes);
app.use('/api/admin/bot', botAdminRoutes);

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
	const tenantCodes = new Set([
		'TENANT_DB_NOT_CONFIGURED',
		'TENANT_DB_DECRYPT_FAILED',
		'TENANT_EMPRESA_NOT_FOUND',
	]);
	const status = tenantCodes.has(err.code) ? 503 : 500;
	res.status(status).json({
		success: false,
		mensaje: err.message || 'Error interno del servidor',
		code: err.code,
		error: process.env.NODE_ENV === 'development' ? err.message : undefined,
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
