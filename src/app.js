/**
 * Configuración principal de la aplicación Express
 * @module app
 */
const express = require('express');
const dotenv = require('dotenv');

// Importar middlewares
const { configureCors } = require('./middlewares/cors.middleware');

// Importar rutas
const authRoutes = require('./routes/auth.routes');
const bedsRoutes = require('./routes/beds.routes');

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
configureCors(app); // Configuración CORS
app.use(express.json()); // Parseo de JSON

// Configurar rutas
app.use('/api/auth', authRoutes);
app.use('/api/beds', bedsRoutes);

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
