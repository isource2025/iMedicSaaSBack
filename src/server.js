/**
 * Punto de entrada principal de la aplicación
 * @module server
 */
require('dotenv').config();

const { logPlatformDbEnvStatus, isPlatformSqlConfigured } = require('./config/database');
const { logAuthDbEnvStatus, isAuthCentralEnabled } = require('./config/authCentralDb');
const app = require('./app');

const PORT = process.env.PORT || 5000;

const authOk = logAuthDbEnvStatus();
logPlatformDbEnvStatus();
if (authOk && !isPlatformSqlConfigured()) {
  console.log(
    '→ Modo Railway: login vía imPassword + imPersonalEmpresas (MySQL); SQL clínico por Empresas.Db*',
  );
} else if (!isAuthCentralEnabled() && isPlatformSqlConfigured()) {
  console.log('→ Modo Render/legacy: login y catálogo en SQL Server plataforma (.env DB_*)');
} else if (!authOk && !isPlatformSqlConfigured()) {
  console.error('→ Sin MySQL auth ni DB_*: configurá AUTH_DB_* o vinculá MySQL en Railway');
}

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
