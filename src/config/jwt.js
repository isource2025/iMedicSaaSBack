/**
 * JWT compartido entre login y middleware de rutas protegidas.
 * En producción definir JWT_SECRET en el entorno.
 */
module.exports = {
	JWT_SECRET: process.env.JWT_SECRET || 'iMedicWs_secret_key_2025',
	TOKEN_EXPIRATION: '24h',
};
