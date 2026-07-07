/**
 * Punto de entrada principal de la aplicación
 * @module server
 */
require('dotenv').config();

const { logPlatformDbEnvStatus, isPlatformSqlConfigured } = require('./config/database');
const { logAuthDbEnvStatus, isAuthCentralEnabled } = require('./config/authCentralDb');
const app = require('./app');

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

function logLanAccessUrls(port) {
	const os = require('os');
	const urls = new Set();
	if (process.env.LAN_IP?.trim()) {
		urls.add(`http://${process.env.LAN_IP.trim()}:${port}`);
	}
	for (const ifaces of Object.values(os.networkInterfaces())) {
		for (const iface of ifaces || []) {
			if (iface.family !== 'IPv4' || iface.internal) continue;
			urls.add(`http://${iface.address}:${port}`);
		}
	}
	if (urls.size === 0) return;
	console.log('→ Red local (API):');
	for (const u of urls) console.log(`   ${u}/api`);
}

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
  console.log('→ Modo local/SQL plataforma: login y catálogo en SQL Server (.env DB_*)');
  if (process.env.LOCAL_DEV_ONLY && ['1', 'true', 'yes'].includes(String(process.env.LOCAL_DEV_ONLY).toLowerCase())) {
    console.log('→ LOCAL_DEV_ONLY=1: sin MySQL Railway; tenant clínico forzado a DB_* local');
  }
} else if (!authOk && !isPlatformSqlConfigured()) {
  console.error('→ Sin MySQL auth ni DB_*: configurá AUTH_DB_* o vinculá MySQL en Railway');
}

app.listen(PORT, HOST, () => {
  console.log(`Servidor ejecutándose en http://${HOST === '0.0.0.0' ? '0.0.0.0' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') logLanAccessUrls(PORT);

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
      if (process.env.WHATSAPP_WEBHOOK_TRUST_META_UA === '0') {
        console.warn('  ⚠ WHATSAPP_WEBHOOK_TRUST_META_UA=0 — si el teléfono no responde, activá trust Meta UA');
      } else if (process.env.NODE_ENV === 'production') {
        console.log('  Trust Meta UA en prod si HMAC falla (Graph API OK) — teléfono real');
      }
    }
    if (!process.env.BOT_API_KEY?.trim() && !process.env.BOT_API_KEYS?.trim()) {
      console.warn('  ⚠ BOT_API_KEY ausente — /integrations/bot/* inactivo (webhook directo /api/webhook/whatsapp OK)');
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
