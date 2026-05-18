/**
 * Matriz de permisos por rol — Fase 2.
 *
 * MODELO JERÁRQUICO:
 *   MODULO  →  SUBMODULO  →  ACCION
 *
 *   Códigos de permiso: 'MODULO.SUBMODULO.ACCION'
 *
 * Acciones canónicas (todas las entidades con CRUD las exponen):
 *   VER, CREAR, EDITAR, ELIMINAR
 * Acciones especiales (donde aplica):
 *   GESTIONAR  (asignaciones, movimientos, configuración)
 *   APLICAR    (firmar / aplicar indicación)
 *   EXPORTAR   (descargar reportes / tablas)
 *   IMPRIMIR
 *
 * IMPORTANTE: este archivo está duplicado y sincronizado con
 * `iMedicWSFront/src/app/utils/permisos.ts`. Si se modifica uno, hay que
 * tocar el otro (y luego ejecutar `node scripts/seed_permisos.js` en el
 * back para reflejar los cambios en BD).
 *
 * Roles definidos en imRoles (IDs fijos):
 *   1 = ADMIN, 2 = MEDICO, 3 = ENFERMERO, 4 = ADMINISTRATIVO
 */

// ============================================================================
// Acciones canónicas
// ============================================================================
const ACCIONES = Object.freeze({
	VER: 'VER',
	CREAR: 'CREAR',
	EDITAR: 'EDITAR',
	ELIMINAR: 'ELIMINAR',
	GESTIONAR: 'GESTIONAR',
	APLICAR: 'APLICAR',
	EXPORTAR: 'EXPORTAR',
	IMPRIMIR: 'IMPRIMIR',
});

const CRUD = Object.freeze([ACCIONES.VER, ACCIONES.CREAR, ACCIONES.EDITAR, ACCIONES.ELIMINAR]);

// ============================================================================
// Estructura de módulos (alineada con el sidebar del frontend)
// ============================================================================
const MODULOS = Object.freeze([
	{
		id: 'DASHBOARD',
		label: 'Dashboard',
		path: '/dashboard',
		submodulos: [
			{ id: 'INICIO', label: 'Inicio', path: '/dashboard', acciones: [ACCIONES.VER] },
		],
	},
	{
		id: 'TURNOS',
		label: 'Turnos',
		submodulos: [
			{ id: 'AGENDA',        label: 'Agenda',           path: '/dashboard/turnos/agenda',        acciones: [...CRUD] },
			{ id: 'ADMIN',         label: 'Admin de Turnos',  path: '/dashboard/turnos/admin',         acciones: [...CRUD, ACCIONES.GESTIONAR] },
			{ id: 'EXCEPCIONES',   label: 'Excepciones',      path: '/dashboard/turnos/excepciones',   acciones: [...CRUD] },
			{ id: 'CONFIGURACION', label: 'Configuración',    path: '/dashboard/turnos/configuracion', acciones: [ACCIONES.VER, ACCIONES.EDITAR, ACCIONES.GESTIONAR] },
			{ id: 'TABLA',         label: 'Tabla de Turnos',  path: '/dashboard/turnos/tabla',         acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
		],
	},
	{
		id: 'ADMISION',
		label: 'Admisión',
		submodulos: [
			{ id: 'PACIENTES', label: 'Pacientes',          path: '/dashboard/patients',         acciones: [...CRUD] },
			{ id: 'BUSQUEDA',  label: 'Consultar Historia Clínica',  path: '/dashboard/admission/search', acciones: [ACCIONES.VER] },
			{ id: 'NUEVA',     label: 'Nueva Admisión',     path: '/dashboard/admission/new',    acciones: [ACCIONES.CREAR] },
			{ id: 'VIGENTES',  label: 'Admisiones Vigentes',path: '/dashboard/admission/current',acciones: [...CRUD, ACCIONES.GESTIONAR] },
			{ id: 'TABLA',     label: 'Tabla de Admisiones',path: '/dashboard/admission/tables', acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
		],
	},
	{
		id: 'INTERNACION',
		label: 'Internación',
		submodulos: [
			{ id: 'CAMAS',           label: 'Gestión de Camas',     path: '/dashboard/beds',           acciones: [...CRUD, ACCIONES.GESTIONAR] },
			{ id: 'OCUPACION',       label: 'Ocupación de Camas',   path: '/dashboard/beds/occupation',acciones: [ACCIONES.VER] },
			{ id: 'TABLA',           label: 'Tabla de Internación', path: '/dashboard/beds/tables',    acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },

			// Funcionalidades clínicas dentro de la cama (sidebar de la cama)
			{ id: 'HISTORIA_CLINICA',     label: 'Historia clínica',         acciones: [...CRUD] },
			{ id: 'INDICACIONES',         label: 'Indicaciones médicas',     acciones: [...CRUD, ACCIONES.APLICAR] },
			{ id: 'EVOLUCIONES',          label: 'Evoluciones médicas',      acciones: [...CRUD] },
			{ id: 'EVOLUCION_ENFERMERIA', label: 'Evolución de enfermería',  acciones: [...CRUD] },
			{ id: 'SIGNOS_VITALES',       label: 'Controles / signos vitales', acciones: [...CRUD] },
			{ id: 'MEDICACION',           label: 'Medicación suministrada',  acciones: [...CRUD] },
			{ id: 'DIETA',                label: 'Dietas',                   acciones: [...CRUD] },
			{ id: 'BALANCE_HIDRICO',      label: 'Balance hídrico',          acciones: [...CRUD] },
			{ id: 'INSUMOS',              label: 'Insumos',                  acciones: [...CRUD] },
			{ id: 'ESTUDIOS',             label: 'Estudios / laboratorios',  acciones: [...CRUD] },
			{ id: 'PROTOCOLOS',           label: 'Protocolos',               acciones: [...CRUD] },
			{ id: 'PROCEDIMIENTOS',       label: 'Procedimientos',           acciones: [...CRUD] },
			{ id: 'MOVIMIENTOS',          label: 'Movimientos / traslados',  acciones: [ACCIONES.VER, ACCIONES.GESTIONAR] },
			{ id: 'ADJUNTOS',             label: 'Adjuntos',                 acciones: [...CRUD] },
			{ id: 'EPICRISIS',            label: 'Epicrisis',                acciones: [...CRUD, ACCIONES.IMPRIMIR] },
		],
	},
	{
		id: 'FACTURACION',
		label: 'Facturación',
		submodulos: [
			{ id: 'CONVENIOS',     label: 'Convenios',     path: '/dashboard/billing/convenios',     acciones: [...CRUD] },
			{ id: 'RENDICIONES',   label: 'Rendiciones',   path: '/dashboard/billing/rendiciones',   acciones: [...CRUD, ACCIONES.EXPORTAR] },
			{ id: 'LIQUIDACIONES', label: 'Liquidaciones', path: '/dashboard/billing/liquidaciones', acciones: [...CRUD, ACCIONES.GESTIONAR] },
			{ id: 'PRACTICAS',     label: 'Prácticas',                                                acciones: [...CRUD] },
			{ id: 'TABLA',         label: 'Tabla de Facturación', path: '/dashboard/billing/tables', acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
		],
	},
	{
		id: 'REPORTES',
		label: 'Reportes',
		submodulos: [
			{ id: 'ESTADISTICAS', label: 'Estadísticas', path: '/dashboard/reports/estadisticas', acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
			{ id: 'FACTURACION',  label: 'Facturación',  path: '/dashboard/reports/facturacion',  acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
			{ id: 'OCUPACION',    label: 'Ocupación',    path: '/dashboard/reports/ocupacion',    acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
		],
	},
	{
		id: 'CONFIGURACION',
		label: 'Configuración',
		submodulos: [
			{ id: 'GENERAL',  label: 'General',  path: '/dashboard/settings/general',  acciones: [ACCIONES.VER, ACCIONES.EDITAR] },
			{ id: 'USUARIOS', label: 'Usuarios', path: '/dashboard/settings/usuarios', acciones: [...CRUD] },
			{ id: 'PERMISOS', label: 'Permisos', path: '/dashboard/settings/permisos', acciones: [ACCIONES.VER, ACCIONES.GESTIONAR] },
			{ id: 'SECTORES', label: 'Sectores', path: '/dashboard/settings/sectores', acciones: [...CRUD] },
			{ id: 'PERSONAL', label: 'Personal', path: '/dashboard/personal',         acciones: [...CRUD, ACCIONES.GESTIONAR] },
		],
	},
	{
		id: 'USUARIO',
		label: 'Usuario',
		submodulos: [
			{ id: 'PERFIL',     label: 'Mi Perfil',     path: '/dashboard/profile', acciones: [ACCIONES.VER, ACCIONES.EDITAR] },
			{ id: 'PRODUCCION', label: 'Mi Producción',                              acciones: [ACCIONES.VER, ACCIONES.EXPORTAR] },
		],
	},
]);

// Helper interno: lista todos los códigos de un submódulo.
function _todas(modId, subId) {
	const mod = MODULOS.find((m) => m.id === modId);
	if (!mod) return [];
	const sub = mod.submodulos.find((s) => s.id === subId);
	if (!sub) return [];
	return sub.acciones.map((a) => `${modId}.${subId}.${a}`);
}

// ============================================================================
// Plantillas por rol (la matriz)
// ============================================================================
const PLANTILLAS = Object.freeze({
	// ──────────────────────────────────────────────────────────────────────
	// ADMIN — todos los permisos disponibles.
	// ──────────────────────────────────────────────────────────────────────
	ADMIN: Object.freeze(
		MODULOS.flatMap((m) =>
			m.submodulos.flatMap((s) => s.acciones.map((a) => `${m.id}.${s.id}.${a}`)),
		),
	),

	// ──────────────────────────────────────────────────────────────────────
	// MEDICO — atención clínica completa. Sólo lee secciones de enfermería.
	// ──────────────────────────────────────────────────────────────────────
	MEDICO: Object.freeze([
		'DASHBOARD.INICIO.VER',

		// Agenda propia (el back fuerza matricula = req.auth.matricula)
		'TURNOS.AGENDA.VER',
		'TURNOS.AGENDA.CREAR',
		'TURNOS.AGENDA.EDITAR',
		'TURNOS.AGENDA.ELIMINAR',
		'TURNOS.EXCEPCIONES.VER',
		'TURNOS.EXCEPCIONES.CREAR',
		'TURNOS.EXCEPCIONES.EDITAR',
		'TURNOS.EXCEPCIONES.ELIMINAR',
		'TURNOS.CONFIGURACION.VER', // sólo lectura de su propia config
		'TURNOS.TABLA.VER',

		'ADMISION.PACIENTES.VER',
		'ADMISION.PACIENTES.CREAR',
		'ADMISION.PACIENTES.EDITAR',
		'ADMISION.BUSQUEDA.VER',
		'ADMISION.VIGENTES.VER',
		'ADMISION.VIGENTES.GESTIONAR',
		'ADMISION.TABLA.VER',

		// Internación: top-level
		'INTERNACION.CAMAS.VER',
		'INTERNACION.CAMAS.GESTIONAR',
		'INTERNACION.OCUPACION.VER',
		'INTERNACION.TABLA.VER',
		// Funcionalidades clínicas: ámbito médico (CRUD completo)
		..._todas('INTERNACION', 'HISTORIA_CLINICA'),
		// Médico: crea, edita y elimina indicaciones, pero NO las aplica (eso es enfermería)
		'INTERNACION.INDICACIONES.VER',
		'INTERNACION.INDICACIONES.CREAR',
		'INTERNACION.INDICACIONES.EDITAR',
		'INTERNACION.INDICACIONES.ELIMINAR',
		..._todas('INTERNACION', 'EVOLUCIONES'),
		..._todas('INTERNACION', 'ESTUDIOS'),
		..._todas('INTERNACION', 'PROTOCOLOS'),
		..._todas('INTERNACION', 'PROCEDIMIENTOS'),
		..._todas('INTERNACION', 'EPICRISIS'),
		'INTERNACION.MOVIMIENTOS.VER',
		'INTERNACION.MOVIMIENTOS.GESTIONAR',
		// Funcionalidades de enfermería: lectura
		'INTERNACION.EVOLUCION_ENFERMERIA.VER',
		'INTERNACION.SIGNOS_VITALES.VER',
		'INTERNACION.MEDICACION.VER',
		'INTERNACION.DIETA.VER',
		'INTERNACION.BALANCE_HIDRICO.VER',
		'INTERNACION.INSUMOS.VER',
		// Adjuntos: ver y crear
		'INTERNACION.ADJUNTOS.VER',
		'INTERNACION.ADJUNTOS.CREAR',

		'FACTURACION.PRACTICAS.VER',
		'FACTURACION.PRACTICAS.CREAR',

		'REPORTES.ESTADISTICAS.VER',
		'REPORTES.OCUPACION.VER',

		'USUARIO.PERFIL.VER',
		'USUARIO.PERFIL.EDITAR',
		'USUARIO.PRODUCCION.VER',
		'USUARIO.PRODUCCION.EXPORTAR',
	]),

	// ──────────────────────────────────────────────────────────────────────
	// ENFERMERO — control asistencial. Lee lo médico y CRUD lo de enfermería.
	// ──────────────────────────────────────────────────────────────────────
	ENFERMERO: Object.freeze([
		'DASHBOARD.INICIO.VER',

		'ADMISION.PACIENTES.VER',
		'ADMISION.BUSQUEDA.VER',
		'ADMISION.VIGENTES.VER',

		'INTERNACION.CAMAS.VER',
		'INTERNACION.CAMAS.GESTIONAR',
		'INTERNACION.OCUPACION.VER',
		// Lectura de lo médico (puede consultar HC, indicaciones, evoluciones)
		'INTERNACION.HISTORIA_CLINICA.VER',
		'INTERNACION.INDICACIONES.VER',
		'INTERNACION.INDICACIONES.APLICAR',  // marcar como aplicada
		'INTERNACION.EVOLUCIONES.VER',
		'INTERNACION.ESTUDIOS.VER',
		'INTERNACION.PROTOCOLOS.VER',
		'INTERNACION.PROCEDIMIENTOS.VER',
		'INTERNACION.EPICRISIS.VER',
		'INTERNACION.MOVIMIENTOS.VER',
		// CRUD de enfermería
		..._todas('INTERNACION', 'EVOLUCION_ENFERMERIA'),
		..._todas('INTERNACION', 'SIGNOS_VITALES'),
		..._todas('INTERNACION', 'MEDICACION'),
		..._todas('INTERNACION', 'DIETA'),
		..._todas('INTERNACION', 'BALANCE_HIDRICO'),
		..._todas('INTERNACION', 'INSUMOS'),
		// Adjuntos
		'INTERNACION.ADJUNTOS.VER',
		'INTERNACION.ADJUNTOS.CREAR',

		'REPORTES.OCUPACION.VER',

		'USUARIO.PERFIL.VER',
		'USUARIO.PERFIL.EDITAR',
	]),

	// ──────────────────────────────────────────────────────────────────────
	// ADMINISTRATIVO — admisión + facturación, sin clínica.
	// ──────────────────────────────────────────────────────────────────────
	ADMINISTRATIVO: Object.freeze([
		'DASHBOARD.INICIO.VER',

		// Gestión total de agenda (cualquier médico)
		'TURNOS.AGENDA.VER',
		'TURNOS.AGENDA.CREAR',
		'TURNOS.AGENDA.EDITAR',
		'TURNOS.AGENDA.ELIMINAR',
		'TURNOS.EXCEPCIONES.VER',
		'TURNOS.EXCEPCIONES.CREAR',
		'TURNOS.EXCEPCIONES.EDITAR',
		'TURNOS.EXCEPCIONES.ELIMINAR',
		'TURNOS.CONFIGURACION.VER',
		'TURNOS.CONFIGURACION.EDITAR',
		'TURNOS.CONFIGURACION.GESTIONAR',
		'TURNOS.TABLA.VER',
		'TURNOS.TABLA.EXPORTAR',
		..._todas('TURNOS', 'ADMIN'),

		'ADMISION.PACIENTES.VER',
		'ADMISION.PACIENTES.CREAR',
		'ADMISION.PACIENTES.EDITAR',
		'ADMISION.BUSQUEDA.VER',
		'ADMISION.NUEVA.CREAR',
		'ADMISION.VIGENTES.VER',
		'ADMISION.VIGENTES.GESTIONAR',
		'ADMISION.TABLA.VER',
		'ADMISION.TABLA.EXPORTAR',

		'INTERNACION.CAMAS.VER',
		'INTERNACION.OCUPACION.VER',
		'INTERNACION.TABLA.VER',
		'INTERNACION.MOVIMIENTOS.VER',

		'FACTURACION.CONVENIOS.VER',
		'FACTURACION.RENDICIONES.VER',
		'FACTURACION.RENDICIONES.CREAR',
		'FACTURACION.RENDICIONES.EDITAR',
		'FACTURACION.RENDICIONES.EXPORTAR',
		'FACTURACION.LIQUIDACIONES.VER',
		'FACTURACION.LIQUIDACIONES.GESTIONAR',
		'FACTURACION.PRACTICAS.VER',
		'FACTURACION.PRACTICAS.CREAR',
		'FACTURACION.PRACTICAS.EDITAR',
		'FACTURACION.TABLA.VER',
		'FACTURACION.TABLA.EXPORTAR',

		'REPORTES.FACTURACION.VER',
		'REPORTES.OCUPACION.VER',

		'CONFIGURACION.PERSONAL.VER',
		'CONFIGURACION.PERSONAL.EDITAR',
		'CONFIGURACION.PERSONAL.GESTIONAR', // necesario para abrir la solapa "Agenda" del modal de Personal

		'USUARIO.PERFIL.VER',
		'USUARIO.PERFIL.EDITAR',
	]),
});

// ============================================================================
// Helpers
// ============================================================================

function _nombreRol(rol) {
	if (!rol) return null;
	const n = typeof rol === 'string' ? rol : rol.nombre || '';
	const up = String(n).trim().toUpperCase();
	return up || null;
}

/** Lista todos los permisos asociados al rol (string[]). */
function permisosDeRol(rol) {
	const n = _nombreRol(rol);
	if (!n) return [];
	const lista = PLANTILLAS[n];
	return lista ? [...lista] : [];
}

/**
 * ¿El rol tiene el permiso indicado?
 *
 * Acepta verificación parcial:
 *   tienePermiso(rol, 'INTERNACION')                    → cualquier sub/acc
 *   tienePermiso(rol, 'INTERNACION.HISTORIA_CLINICA')   → cualquier acción
 *   tienePermiso(rol, 'INTERNACION.HISTORIA_CLINICA.VER')
 */
function tienePermiso(rol, codigo) {
	if (!codigo) return false;
	const lista = permisosDeRol(rol);
	const c = String(codigo);
	if (lista.includes(c)) return true;
	const dots = (c.match(/\./g) || []).length;
	if (dots < 2) {
		const prefijo = c + '.';
		return lista.some((p) => p.startsWith(prefijo));
	}
	return false;
}

function tieneAccesoAModulo(rol, idModulo) {
	const prefijo = `${String(idModulo).toUpperCase()}.`;
	return permisosDeRol(rol).some((p) => p.startsWith(prefijo));
}

function tieneAccesoASubmodulo(rol, idModulo, idSubmodulo) {
	const prefijo = `${String(idModulo).toUpperCase()}.${String(idSubmodulo).toUpperCase()}.`;
	return permisosDeRol(rol).some((p) => p.startsWith(prefijo));
}

/** Árbol MODULOS filtrado a lo que el rol puede ver. */
function modulosVisibles(rol) {
	const permisos = new Set(permisosDeRol(rol));
	const out = [];
	for (const m of MODULOS) {
		const subs = m.submodulos.filter((s) =>
			s.acciones.some((a) => permisos.has(`${m.id}.${s.id}.${a}`)),
		);
		if (subs.length) out.push({ ...m, submodulos: subs });
	}
	return out;
}

/** Devuelve el listado plano de TODOS los códigos definidos en MODULOS. */
function todosLosCodigos() {
	const out = [];
	for (const m of MODULOS) {
		for (const s of m.submodulos) {
			for (const a of s.acciones) out.push({ modulo: m.id, submodulo: s.id, accion: a, codigo: `${m.id}.${s.id}.${a}` });
		}
	}
	return out;
}

module.exports = {
	ACCIONES,
	CRUD,
	MODULOS,
	PLANTILLAS,
	permisosDeRol,
	tienePermiso,
	tieneAccesoAModulo,
	tieneAccesoASubmodulo,
	modulosVisibles,
	todosLosCodigos,
};
