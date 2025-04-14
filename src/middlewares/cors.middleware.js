const cors = require('cors');


const configureCors = (app) => {
  // Obtener orígenes permitidos de la variable de entorno
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [];

  // Configuración de CORS
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('No permitido por CORS'));
      }
    },
    credentials: true 
  }));
  
  // Manejar errores CORS
  app.use((err, req, res, next) => {
    if (err.message.includes('CORS')) {
      return res.status(403).json({
        success: false,
        mensaje: 'Acceso no permitido por política CORS',
        error: err.message
      });
    }
    next(err);
  });
};

module.exports = {
  configureCors
};
