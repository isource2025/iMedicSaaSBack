const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
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
