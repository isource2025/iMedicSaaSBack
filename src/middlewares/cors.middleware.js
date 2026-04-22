const cors = require('cors');

/** Orígenes típicos de front en la misma red local (pruebas desde móvil / otra máquina). */
function isNonProductionLanOrigin(origin) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LAN_CORS !== '1') {
    return false;
  }
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  } catch {
    return false;
  }
  return false;
}

const configureCors = (app) => {
  // Obtener orígenes permitidos de la variable de entorno
  const allowedOrigins = (process.env.CORS_ORIGINS?.split(',') || [])
    .map((s) => s.trim())
    .filter(Boolean);

  // Configuración de CORS
  app.use(cors({
    origin: (origin, callback) => {
      // Sin CORS_ORIGINS (desarrollo / LAN): permitir cualquier origen con credenciales vía reflect
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else if (isNonProductionLanOrigin(origin)) {
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
