/**
 * Pantallas que existen en el front (src/app/dashboard/**\/page.tsx), para que el
 * asistente nunca ofrezca un link que termine en 404. Las rutas de la matriz de
 * permisos no alcanzan: algunas no tienen página propia.
 * tests/asistente.rutas.test.js compara esta lista con las carpetas del front.
 */
const RUTAS = Object.freeze([
	'/dashboard',
	'/dashboard/admin/users',
	'/dashboard/admission/new',
	'/dashboard/admission/search',
	'/dashboard/admission/tables',
	'/dashboard/almacen',
	'/dashboard/bandeja-pedidos',
	'/dashboard/bed-detail',
	'/dashboard/beds',
	'/dashboard/beds/analytics',
	'/dashboard/beds/tables',
	'/dashboard/billing/liquidaciones',
	'/dashboard/billing/rendiciones',
	'/dashboard/billing/tables',
	'/dashboard/configuracion/consumo-ia',
	'/dashboard/configuracion/institucion',
	'/dashboard/configuracion/permisos',
	'/dashboard/patients',
	'/dashboard/patients/analytics',
	'/dashboard/personal',
	'/dashboard/profile',
	'/dashboard/reports/facturacion',
	'/dashboard/settings/sectores',
	'/dashboard/settings/servicios',
	'/dashboard/turnos/admin',
	'/dashboard/turnos/agenda',
	'/dashboard/turnos/analytics',
	'/dashboard/turnos/bandeja-pedidos',
	'/dashboard/turnos/bot',
	'/dashboard/turnos/chats',
	'/dashboard/turnos/configuracion',
]);

const DINAMICAS = Object.freeze([/^\/dashboard\/beds\/\d+$/, /^\/dashboard\/visita\/\d+$/]);

const SET = new Set(RUTAS);

function existe(path) {
	const p = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
	return SET.has(p) || DINAMICAS.some((re) => re.test(p));
}

module.exports = { RUTAS, DINAMICAS, existe };
