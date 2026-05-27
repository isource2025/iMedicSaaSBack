/**
 * Packs modulares de onboarding por empresa.
 * Los módulos generales siempre están disponibles para cualquier tenant.
 */

const PACKS_PRINCIPALES = Object.freeze([
	{
		codigo: 'AGENDA',
		label: 'Agenda / Turnos',
		descripcion: 'Agenda médica, admin de turnos, excepciones y configuración.',
		modulos: ['TURNOS'],
		orden: 1,
	},
	{
		codigo: 'INTERNACION',
		label: 'Internación',
		descripcion: 'Camas, ocupación, evoluciones, indicaciones y módulos clínicos de cama.',
		modulos: ['INTERNACION'],
		orden: 2,
	},
	{
		codigo: 'FACTURACION',
		label: 'Facturación',
		descripcion: 'Convenios, rendiciones, liquidaciones y prácticas.',
		modulos: ['FACTURACION'],
		orden: 3,
	},
]);

/** Siempre habilitados (menú general). */
const MODULOS_GENERALES = Object.freeze([
	'DASHBOARD',
	'ADMISION',
	'REPORTES',
	'CONFIGURACION',
	'USUARIO',
]);

const PASOS_ONBOARDING = Object.freeze([
	{ id: 'DATOS', label: 'Datos de la empresa' },
	{ id: 'MODULOS', label: 'Módulos contratados' },
	{ id: 'SECTORES', label: 'Sectores y servicios' },
	{ id: 'USUARIOS', label: 'Usuarios iniciales' },
	{ id: 'COBRANZA', label: 'Plan y cobranza' },
	{ id: 'ACTIVACION', label: 'Activación' },
]);

const PLANES = Object.freeze([
	{ id: 'STARTER', label: 'Starter', importeSugerido: 0 },
	{ id: 'PRO', label: 'Professional', importeSugerido: 85000 },
	{ id: 'ENTERPRISE', label: 'Enterprise', importeSugerido: 180000 },
]);

const ESTADOS_SUSCRIPCION = Object.freeze([
	'PRUEBA',
	'ACTIVA',
	'SUSPENDIDA',
	'CANCELADA',
]);

function packsActivosToModulos(packsActivos) {
	const set = new Set(MODULOS_GENERALES);
	for (const codigo of packsActivos || []) {
		const pack = PACKS_PRINCIPALES.find((p) => p.codigo === codigo);
		if (pack) pack.modulos.forEach((m) => set.add(m));
	}
	return [...set];
}

/** Todos los módulos disponibles (sin filtrar por packs de la empresa). */
function todosModulosHabilitados() {
	const set = new Set(MODULOS_GENERALES);
	for (const pack of PACKS_PRINCIPALES) {
		pack.modulos.forEach((m) => set.add(m));
	}
	return [...set];
}

function esSuperAdmin(rolNombre) {
	return String(rolNombre || '').trim().toUpperCase() === 'SUPER_ADMIN';
}

module.exports = {
	PACKS_PRINCIPALES,
	MODULOS_GENERALES,
	PASOS_ONBOARDING,
	PLANES,
	ESTADOS_SUSCRIPCION,
	packsActivosToModulos,
	todosModulosHabilitados,
	esSuperAdmin,
};
