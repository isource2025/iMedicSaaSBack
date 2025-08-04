/**
 * Configuración principal de la aplicación Express
 * @module app
 */
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
// Importar middlewares
// const { configureCors } = require('./middlewares/cors.middleware');

// Importar rutas
const authRoutes = require('./routes/auth.routes');
const bedsRoutes = require('./routes/beds.routes');
const patientsRoutes = require('./routes/patients.routes');
const empresaRoutes = require('./routes/empresa.routes');
const catalogsRoutes = require('./routes/catalogs.routes');
const localidadesRoutes = require('./routes/localidades.routes');
const sexoRoutes = require('./routes/sexo.routes');
const localidadRoutes = require('./routes/localidad.routes');
const opcGrdRoutes = require('./routes/opcGrd.routes');
const clasePacienteRoutes = require('./routes/clasePaciente.routes');
const dadorOrganosRoutes = require('./routes/dadorOrganos.routes');
const diagnosticoRoutes = require('./routes/diagnostico.routes');
const disposicionEgresoRoutes = require('./routes/disposicionEgreso.routes');
const estadoAmbulatorioRoutes = require('./routes/estadoAmbulatorio.routes');
const estadoCivilRoutes = require('./routes/estadoCivil.routes');
const estadoMilitarRoutes = require('./routes/estadoMilitar.routes');
const grupoEtnicoRoutes = require('./routes/grupoEtnico.routes');
const idiomasISORoutes = require('./routes/idiomasISO.routes');
const nacionalidadRoutes = require('./routes/nacionalidad.routes');
const parentescoRoutes = require('./routes/parentesco.routes');
const provinciaRoutes = require('./routes/provincia.routes');
const razaRoutes = require('./routes/raza.routes');
const religionRoutes = require('./routes/religion.routes');
const requisitoRoutes = require('./routes/requisito.routes');
const rolContactoRoutes = require('./routes/rolContacto.routes');
const tipoAdmisionRoutes = require('./routes/tipoAdmision.routes');
const tipoPacienteRoutes = require('./routes/tipoPaciente.routes');

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
  .catch(err => {
    console.error('Error de conexión a la base de datos:', err.message);
    // No finalizamos el proceso para que el servidor siga funcionando
    // incluso si la base de datos no está disponible inicialmente
  });

// Configurar middlewares
// configureCors(app); // Configuración CORS
//Permitir solo desde tu Frontend (opcion recomendada)
app.use(cors())

app.use(express.json()); // Parseo de JSON

// Configurar rutas
app.use('/api/auth', authRoutes);
app.use('/api/beds', bedsRoutes);
app.use('/api/patients', patientsRoutes);
app.use('/api/empresa', empresaRoutes);
app.use('/api/catalogs', catalogsRoutes);
app.use('/api/localidades', localidadesRoutes);
app.use('/api/sexo', sexoRoutes);
app.use('/api/localidad', localidadRoutes);
app.use('/api/admin/opcgrd', opcGrdRoutes); // Ruta protegida para administradores
app.use('/api/clases-paciente', clasePacienteRoutes);
app.use('/api/dadores-organos', dadorOrganosRoutes);
app.use('/api/diagnosticos', diagnosticoRoutes);
app.use('/api/disposiciones-egreso', disposicionEgresoRoutes);
app.use('/api/estados-ambulatorios', estadoAmbulatorioRoutes);
app.use('/api/estados-civiles', estadoCivilRoutes);
app.use('/api/estados-militares', estadoMilitarRoutes);
app.use('/api/grupos-etnicos', grupoEtnicoRoutes);
app.use('/api/idiomas-iso', idiomasISORoutes);
app.use('/api/nacionalidad', nacionalidadRoutes);
app.use('/api/parentesco', parentescoRoutes);
app.use('/api/provincia', provinciaRoutes);
app.use('/api/raza', razaRoutes);
app.use('/api/religion', religionRoutes);
app.use('/api/requisitos', requisitoRoutes);
app.use('/api/rolcontacto', rolContactoRoutes);
app.use('/api/sexo', sexoRoutes);
app.use('/api/tipoadmision', tipoAdmisionRoutes);
app.use('/api/tipopaciente', tipoPacienteRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('API de iMedicWS funcionando correctamente');
});

// Middleware para manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error en la aplicación:', err);
  res.status(500).json({
    success: false,
    mensaje: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Error interno'
  });
});

// Middleware para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    success: false,
    mensaje: 'Ruta no encontrada'
  });
});

module.exports = app;
