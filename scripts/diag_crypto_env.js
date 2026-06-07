/**
 * Diagnóstico local: descifrado Empresa 1 MySQL + variables de entorno.
 * Uso: node scripts/diag_crypto_env.js
 */
require('dotenv').config();
const diag = require('../src/utils/diagLog');

(async () => {
	diag.logStartupEnv();
	await diag.testEmpresa1OnStartup();
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
