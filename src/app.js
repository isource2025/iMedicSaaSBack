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
const provinciaRoutes = require('./routes/provincias.routes');
const localidadesRoutes = require('./routes/localidades.routes');
const sexoRoutes = require('./routes/sexo.routes');
const localidadRoutes = require('./routes/localidad.routes');
const estadosAmbulatoriosRoutes = require('./routes/estadosAmbulatorios');
const opcGrdRoutes = require('./routes/opcGrd.routes');
const renaperRoutes = require('./routes/renaper.routes');

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
app.use('/api/provincias', provinciaRoutes);
app.use('/api/sexo', sexoRoutes);
app.use('/api/localidad', localidadRoutes);
app.use('/api/estados-ambulatorios', estadosAmbulatoriosRoutes);
app.use('/api/admin/opcgrd', opcGrdRoutes); // Ruta protegida para administradores
app.use('/api/renaper', renaperRoutes);

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
