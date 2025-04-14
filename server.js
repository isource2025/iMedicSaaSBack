const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB } = require('./config/db');

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// Rutas
const authRoutes = require('./routes/auth');
const bedsRoutes = require('./routes/beds');

app.use('/api/auth', authRoutes);
app.use('/api/beds', bedsRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('API de iMedicWS funcionando correctamente');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
