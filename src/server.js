/**
 * Punto de entrada principal de la aplicación
 * @module server
 */
require('dotenv').config();

const { logPlatformDbEnvStatus, isPlatformSqlConfigured } = require('./config/database');
const { logAuthDbEnvStatus, isAuthCentralEnabled } = require('./config/authCentralDb');
const app = require('./app');

const PORT = process.env.PORT || 5000;

logAuthDbEnvStatus();
logPlatformDbEnvStatus();
if (isAuthCentralEnabled() && !isPlatformSqlConfigured()) {
  console.log('→ Modo Railway: login/catálogo en MySQL; datos clínicos por Empresas.DbServer/DbName/...');
} else if (!isAuthCentralEnabled() && isPlatformSqlConfigured()) {
  console.log('→ Modo Render/legacy: login y catálogo en SQL Server plataforma (.env DB_*)');
}

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
