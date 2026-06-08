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
if (process.env.PLATFORM_DB_SECRET?.trim()) {
	console.log('✓ PLATFORM_DB_SECRET configurado (descifrado DbPasswordEnc)');
} else if (authOk) {
	console.warn(
		'⚠ PLATFORM_DB_SECRET no definido — DbPasswordEnc usará JWT_SECRET o valor por defecto; debe coincidir con el cifrado en MySQL',
	);
}
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

  const diag = require('./utils/diagLog');
  diag.logStartupEnv();

  if (process.env.WHATSAPP_VERIFY_TOKEN?.trim()) {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    const base = domain
      ? `https://${domain}`
      : process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '') || `http://localhost:${PORT}`;
    console.log(`✓ WhatsApp webhook GET/POST → ${base}/api/webhook/whatsapp`);
    console.log(`  Verify token configurado (WHATSAPP_VERIFY_TOKEN)`);
    if (process.env.META_APP_SECRET?.trim()) {
      console.log('  Firma webhook activa (META_APP_SECRET)');
    }
    if (process.env.META_APP_ID?.trim()) {
      console.log(`  Meta App ID: ${process.env.META_APP_ID.trim()}`);
    }
  } else {
    console.warn('⚠ WHATSAPP_VERIFY_TOKEN no definido — webhook Meta inactivo');
  }

  setTimeout(() => {
    diag.testMetaAppSecretOnStartup()
      .then(() => diag.testEmpresa1OnStartup())
      .catch((e) => {
        diag.warn('startup', 'Diagnóstico error', { error: e.message });
      });
  }, 2000);
});
