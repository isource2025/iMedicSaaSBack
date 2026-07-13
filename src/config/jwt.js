/**
 * JWT compartido entre login y middleware de rutas protegidas.
 * En producción JWT_SECRET es obligatorio (ver security.assertJwtSecret).
 */
const { assertJwtSecret } = require('./security');

try {
	assertJwtSecret();
} catch (e) {
	if (process.env.NODE_ENV === 'production') throw e;
	console.warn('[jwt]', e.message);
}

const JWT_SECRET = process.env.JWT_SECRET || 'iMedicWs_secret_key_2025_dev_only';

module.exports = {
	JWT_SECRET,
	/** Ventana técnica del access token; la inactividad real la controla AuthSessions. */
	ACCESS_TOKEN_EXPIRATION: process.env.ACCESS_TOKEN_EXPIRATION || '24h',
	TEMP_TOKEN_EXPIRATION: '5m',
	/** Compatibilidad legacy */
	TOKEN_EXPIRATION: process.env.ACCESS_TOKEN_EXPIRATION || '24h',
};
