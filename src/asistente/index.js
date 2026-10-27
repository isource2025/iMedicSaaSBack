/**
 * Asistente de plataforma iMedic.
 * Módulo aparte: consume auth, tenant, permisos y rutas HTTP existentes.
 */
const routes = require('./routes');
const httpInterno = require('./httpInterno');
const catalogo = require('./catalogo');
const { agenteLoop } = require('./loop');

function bindApp(app) {
	httpInterno.bindApp(app);
}

module.exports = {
	routes,
	bindApp,
	catalogo,
	agenteLoop,
};
