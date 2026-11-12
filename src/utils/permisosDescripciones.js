/**
 * Descripciones legibles de la matriz de permisos.
 *
 * Se mantiene separado de `permisos.js` para no alterar la estructura de
 * MODULOS. Cada submódulo tiene una descripción general y, cuando el
 * significado de una acción depende del submódulo, un texto propio; si no, se
 * usa el texto genérico de la acción.
 *
 * Resolución de una descripción de permiso (`MODULO.SUBMODULO.ACCION`):
 *   1) texto propio en SUBMODULOS[MODULO.SUBMODULO].acciones[ACCION]
 *   2) "<acción genérica> — <submódulo>"
 */
const { MODULOS } = require('./permisos');

/** Texto genérico por acción. */
const ACCION_GENERICA = Object.freeze({
	VER: 'Ver y consultar la información',
	CREAR: 'Crear registros nuevos',
	EDITAR: 'Modificar registros existentes',
	ELIMINAR: 'Eliminar registros',
	GESTIONAR: 'Acciones de administración avanzada',
	TRASLADAR: 'Cambiar, intercambiar o asignar cama a un paciente internado',
	APLICAR: 'Marcar como aplicado o cumplido',
	EXPORTAR: 'Descargar la información (Excel/PDF)',
	IMPRIMIR: 'Imprimir el documento',
	EDITAR_AJENOS:
		'Modificar o eliminar lo que cargó otro profesional (override tipo admin clínico)',
	CERRAR: 'Cerrar el registro o la atención',
	MARCAR_VISTO: 'Marcar como visto',
	VER_TODOS: 'Ver de todos los sectores',
	SOLO_PROPIA: 'Limitar el alcance a lo propio',
});

/**
 * Submódulos: `descripcion` (qué es) y `acciones` (textos propios opcionales).
 * Clave: 'MODULO.SUBMODULO'.
 */
const SUBMODULOS = Object.freeze({
	// ── Dashboard ─────────────────────────────────────────────────────────
	'DASHBOARD.INICIO': {
		descripcion: 'Panel de control con las métricas generales de la clínica.',
		acciones: { VER: 'Ver el panel de control de inicio' },
	},

	// ── Turnos ────────────────────────────────────────────────────────────
	'TURNOS.AGENDA': {
		descripcion: 'Agenda de turnos: calendario de citas de los pacientes.',
		acciones: {
			VER: 'Ver la agenda y los turnos',
			CREAR: 'Dar turnos nuevos',
			EDITAR: 'Modificar, mover o cambiar el estado de un turno',
			ELIMINAR: 'Cancelar o eliminar turnos',
			CERRAR: 'Cerrar un turno y editar la atención post-cierre',
			SOLO_PROPIA: 'Limitar la agenda a la matrícula propia (sin GESTIONAR, fuerza alcance propio)',
			GESTIONAR: 'Operar agendas de cualquier profesional (por id de turno)',
		},
	},
	'TURNOS.ADMIN': {
		descripcion: 'Gestión de turnos: administración de los turnos de todos los profesionales.',
		acciones: { GESTIONAR: 'Acciones administrativas avanzadas sobre los turnos' },
	},
	'TURNOS.EXCEPCIONES': {
		descripcion: 'Excepciones de agenda: ausencias, bloqueos de horarios y días especiales.',
	},
	'TURNOS.CONFIGURACION': {
		descripcion: 'Configuración de las agendas: horarios, duración de turnos y canales.',
		acciones: {
			VER: 'Ver la configuración de agendas',
			EDITAR: 'Modificar la configuración de agendas',
			GESTIONAR: 'Administrar la configuración de todas las agendas',
		},
	},
	'TURNOS.TABLA': {
		descripcion: 'Tabla de turnos para consulta y exportación.',
		acciones: { VER: 'Ver la tabla de turnos', EXPORTAR: 'Descargar la tabla de turnos' },
	},
	'TURNOS.CONVERSACIONES': {
		descripcion: 'Bandeja de conversaciones WhatsApp vinculadas a turnos.',
		acciones: { VER: 'Ver y atender conversaciones de WhatsApp' },
	},

	// ── Admisión ──────────────────────────────────────────────────────────
	'ADMISION.PACIENTES': {
		descripcion: 'Fichas de pacientes: datos personales, cobertura y contactos.',
		acciones: {
			VER: 'Ver y buscar pacientes',
			CREAR: 'Dar de alta pacientes',
			EDITAR: 'Modificar los datos de un paciente',
			ELIMINAR: 'Eliminar pacientes',
		},
	},
	'ADMISION.BUSQUEDA': {
		descripcion: 'Consulta general de admisiones: búsqueda de pacientes y de sus admisiones.',
		acciones: { VER: 'Buscar pacientes y consultar su historia clínica' },
	},
	'ADMISION.NUEVA': {
		descripcion: 'Nueva admisión: registrar el ingreso de un paciente.',
		acciones: { CREAR: 'Registrar una nueva admisión' },
	},
	'ADMISION.TABLA': {
		descripcion: 'Tabla de admisiones para consulta y exportación.',
		acciones: { VER: 'Ver la tabla de admisiones', EXPORTAR: 'Descargar la tabla de admisiones' },
	},

	// ── Internación ───────────────────────────────────────────────────────
	'INTERNACION.CAMAS': {
		descripcion: 'Gestión de camas: tablero de camas y pacientes internados por sector.',
		acciones: {
			VER: 'Ver el tablero de camas y abrir la ficha del internado',
			CREAR: 'Crear camas',
			EDITAR: 'Modificar camas',
			ELIMINAR: 'Eliminar camas',
			GESTIONAR: 'Cambiar el estado de una cama',
		},
	},
	'INTERNACION.TABLA': {
		descripcion: 'Tabla de internación para consulta y exportación.',
		acciones: { VER: 'Ver la tabla de internación', EXPORTAR: 'Descargar la tabla de internación' },
	},
	'INTERNACION.HISTORIA_CLINICA': {
		descripcion: 'Historia clínica de ingreso del paciente internado: anamnesis, examen físico y antecedentes.',
	},
	'INTERNACION.INDICACIONES': {
		descripcion: 'Indicaciones médicas del paciente internado.',
		acciones: {
			CREAR: 'Indicar (prescribir) nuevas indicaciones médicas',
			EDITAR: 'Modificar indicaciones médicas (dejar sin efecto incluido)',
			ELIMINAR: 'Eliminar indicaciones médicas',
			APLICAR: 'Marcar una indicación como aplicada (tarea de enfermería)',
			MARCAR_VISTO: 'Marcar indicaciones nuevas como vistas al salir de la ficha',
		},
	},
	'INTERNACION.EVOLUCIONES': { descripcion: 'Evoluciones médicas del paciente internado.' },
	'INTERNACION.INTERCONSULTAS': {
		descripcion:
			'Interconsultas entre profesionales: solicitarlas en la ficha, verlas en la bandeja de pedidos (pestaña Interconsultas), responderlas y recibir notificaciones.',
		acciones: {
			VER:
				'Ver interconsultas en la ficha, entrar a la bandeja (pestaña Interconsultas), ver notificaciones de interconsultas libres y responderlas. El alcance por sector lo define la configuración de personal, no este permiso.',
			CREAR: 'Crear una interconsulta nueva desde la ficha del paciente.',
			EDITAR: 'Modificar una interconsulta propia aún no respondida.',
			ELIMINAR: 'Eliminar una interconsulta aún no respondida.',
			VER_TODOS:
				'Ver en la bandeja las interconsultas de todos los sectores, no solo las del servicio/sector del usuario.',
		},
	},
	'INTERNACION.EVOLUCION_ENFERMERIA': { descripcion: 'Evolución de enfermería del paciente internado.' },
	'INTERNACION.SIGNOS_VITALES': {
		descripcion: 'Controles frecuentes y signos vitales del paciente.',
	},
	'INTERNACION.MEDICACION': {
		descripcion: 'Medicación suministrada: registro de la administración de medicamentos.',
	},
	'INTERNACION.DIETA': { descripcion: 'Dietas indicadas al paciente internado.' },
	'INTERNACION.BALANCE_HIDRICO': {
		descripcion: 'Balance hídrico: ingresos y egresos de líquidos del paciente.',
	},
	'INTERNACION.INSUMOS': { descripcion: 'Insumos utilizados en el paciente internado.' },
	'INTERNACION.ESTUDIOS': {
		descripcion:
			'Pedidos de estudios complementarios (laboratorio, tomografía, rayos, etc.): solicitarlos en la ficha, verlos en la bandeja de pedidos, tomarlos, responderlos y recibir notificaciones. No es el visualizador PACS del tomógrafo (eso va con Adjuntos / Estudios PACS).',
		acciones: {
			VER:
				'Ver pedidos de estudios en la ficha del paciente, entrar a la bandeja de pedidos, ver el contador/notificaciones de pedidos libres de su servicio-sector, tomar/liberar un pedido y cargarle la respuesta (cumplir). Con solo VER ya puede operar la bandeja; el filtro de qué servicios ve lo define la configuración de personal/sector, no este permiso.',
			CREAR:
				'Crear un pedido de estudio nuevo (solicitud desde internación o agenda). No hace falta para responder pedidos ajenos: eso lo cubre VER.',
			EDITAR:
				'Modificar un pedido de estudio ya cargado (datos de la solicitud, antes de cumplirlo). No reemplaza a VER para la bandeja.',
			ELIMINAR: 'Eliminar un pedido de estudio que todavía no fue cumplido.',
			VER_TODOS:
				'Ver en la bandeja los pedidos de todos los sectores/servicios, no solo los del servicio asignado al usuario. Sin esto, la bandeja se limita a los sectores configurados en su ficha de personal.',
		},
	},
	'INTERNACION.REGISTROS': {
		descripcion:
			'Permiso especial (tipo admin clínico) para intervenir sobre la historia clínica y demás registros cargados por otro profesional.',
		acciones: {
			EDITAR_AJENOS:
				'Modificar o eliminar historia clínica, evoluciones, indicaciones, controles, dietas, adjuntos y demás registros clínicos creados por otro profesional',
		},
	},
	'INTERNACION.PROTOCOLOS': { descripcion: 'Protocolos registrados del paciente internado.' },
	'INTERNACION.PROCEDIMIENTOS': { descripcion: 'Procedimientos realizados al paciente internado.' },
	'INTERNACION.MOVIMIENTOS': {
		descripcion: 'Movimientos y traslados del paciente: cambios de cama y gestión del egreso.',
		acciones: {
			VER: 'Ver el historial de movimientos del paciente',
			TRASLADAR: 'Mover, intercambiar o asignar cama (sin gestionar el egreso)',
			GESTIONAR:
				'Gestionar el egreso completo (registrar, modificar y eliminar/revertir) y editar el último movimiento; incluye trasladar',
		},
	},
	'INTERNACION.ADJUNTOS': {
		descripcion:
			'Archivos adjuntos de la internación (PDF, imágenes, informes) y pestaña Estudios PACS del tomógrafo (ClearCanvas): listar y abrir series DICOM vinculadas a la visita por DNI y fecha.',
		acciones: {
			VER:
				'Ver la sección Archivos adjuntos de la cama, listar archivos y abrir Estudios PACS (imágenes del tomógrafo). También habilita la API PACS. No alcanza para subir archivos nuevos.',
			CREAR:
				'Subir adjuntos nuevos (archivos o serie DICOM local) y, por compatibilidad, también permite responder pedidos de estudios en la bandeja.',
			EDITAR:
				'Modificar adjuntos propios (los cargados por otro profesional requieren INTERNACION.REGISTROS.EDITAR_AJENOS).',
			ELIMINAR:
				'Eliminar adjuntos propios (los ajenos requieren INTERNACION.REGISTROS.EDITAR_AJENOS).',
		},
	},
	'INTERNACION.EPICRISIS': {
		descripcion: 'Epicrisis: resumen de alta del paciente internado.',
		acciones: { IMPRIMIR: 'Imprimir la epicrisis' },
	},
	'INTERNACION.AUDITORIA_HC': {
		descripcion: 'Auditoría de la historia clínica: quién modificó o borró qué. Reservado a administradores.',
		acciones: { VER: 'Ver el historial de cambios de la historia clínica' },
	},

	// ── Facturación ───────────────────────────────────────────────────────
	'FACTURACION.CONVENIOS': { descripcion: 'Convenios con obras sociales y coberturas.' },
	'FACTURACION.RENDICIONES': {
		descripcion: 'Rendiciones de facturación a obras sociales.',
		acciones: { EXPORTAR: 'Descargar las rendiciones' },
	},
	'FACTURACION.LIQUIDACIONES': {
		descripcion: 'Liquidaciones de las obras sociales.',
		acciones: { GESTIONAR: 'Importar y aplicar el Excel de liquidación de la obra social' },
	},
	'FACTURACION.PRACTICAS': { descripcion: 'Prácticas facturables cargadas por los profesionales.' },
	'FACTURACION.TABLA': {
		descripcion: 'Tabla de facturación para consulta y exportación.',
		acciones: { VER: 'Ver la tabla de facturación', EXPORTAR: 'Descargar la tabla de facturación' },
	},

	// ── Almacén ───────────────────────────────────────────────────────────
	'ALMACEN.PRODUCTOS': { descripcion: 'Catálogo de productos del almacén.' },
	'ALMACEN.REMITOS': { descripcion: 'Remitos de mercadería (cabecera e ítems).' },
	'ALMACEN.STOCK': { descripcion: 'Existencias por depósito (dbo.Stock).' },
	'ALMACEN.PROVEEDORES': { descripcion: 'Proveedores Clarion (dbo.PROVEEDORES).' },

	// ── Reportes ──────────────────────────────────────────────────────────
	'REPORTES.ESTADISTICAS': { descripcion: 'Reportes estadísticos de la actividad.' },
	'REPORTES.FACTURACION': { descripcion: 'Reportes de facturación.' },
	'REPORTES.OCUPACION': { descripcion: 'Reportes de ocupación de camas.' },

	// ── Configuración ─────────────────────────────────────────────────────
	'CONFIGURACION.PERSONAL': {
		descripcion: 'Personal: usuarios del sistema, sus datos, accesos y roles.',
		acciones: {
			VER: 'Ver el listado y la ficha del personal',
			CREAR: 'Dar de alta personal y usuarios',
			EDITAR: 'Modificar datos, accesos y roles del personal',
			ELIMINAR: 'Dar de baja personal',
			GESTIONAR: 'Acciones avanzadas sobre el personal (sincronización, contraseñas)',
		},
	},
	'CONFIGURACION.ROLES': {
		descripcion: 'Matriz de permisos: roles de la clínica y los permisos de cada uno.',
		acciones: {
			VER: 'Ver los roles y la matriz de permisos',
			CREAR: 'Crear roles personalizados',
			EDITAR: 'Modificar los permisos de roles personalizados',
			ELIMINAR: 'Eliminar roles personalizados sin usuarios',
		},
	},
	'CONFIGURACION.INSTITUCION': {
		descripcion: 'Datos de la institución y logo que encabezan los PDFs.',
		acciones: {
			VER: 'Ver los datos y el logo de la institución',
			EDITAR: 'Corregir los datos de la institución y subir, cambiar o quitar el logo',
		},
	},
	'CONFIGURACION.OPCGRD': {
		descripcion: 'Opciones de grilla (catálogo técnico de columnas y vistas).',
	},

	// ── Asistente ─────────────────────────────────────────────────────────
	'ASISTENTE.SQL': {
		descripcion: 'Consultas SQL de solo lectura del asistente sobre la base del establecimiento.',
		acciones: { VER: 'Ejecutar consultas SELECT de solo lectura vía el asistente' },
	},

	// ── Plataforma (solo super administradores) ───────────────────────────
	'PLATAFORMA.PANEL': { descripcion: 'Panel de la plataforma.' },
	'PLATAFORMA.EMPRESAS': { descripcion: 'Empresas (clínicas) de la plataforma.' },
	'PLATAFORMA.USUARIOS': { descripcion: 'Usuarios de todas las empresas.' },
	'PLATAFORMA.ONBOARDING': { descripcion: 'Alta de nuevas empresas.' },
	'PLATAFORMA.COBRANZA': { descripcion: 'Cobranza de las empresas.' },
	'PLATAFORMA.CONFIG': { descripcion: 'Configuración de la plataforma.' },
	'PLATAFORMA.SEGURIDAD': { descripcion: 'Seguridad de la plataforma.' },
	'PLATAFORMA.ANALITICA': { descripcion: 'Analítica de uso de la plataforma.' },
	'PLATAFORMA.CHATS_IA': {
		descripcion: 'Monitoreo global de conversaciones con el asistente de IA en todas las empresas.',
		acciones: { VER: 'Ver mensajes, costos y detalle de chats IA de toda la plataforma' },
	},

	// ── Mi perfil ─────────────────────────────────────────────────────────
	'USUARIO.PERFIL': {
		descripcion: 'Perfil propio del usuario.',
		acciones: { VER: 'Ver y editar el perfil propio' },
	},
	'USUARIO.PRODUCCION': {
		descripcion: 'Producción propia del profesional.',
		acciones: { VER: 'Ver la producción propia del mes', EXPORTAR: 'Descargar la producción propia' },
	},
});

/**
 * Permisos que NUNCA se pueden incluir en un rol personalizado (evita que un
 * rol otorgue privilegios de plataforma o administre roles).
 */
const PREFIJOS_RESTRINGIDOS = Object.freeze(['PLATAFORMA.', 'CONFIGURACION.ROLES.']);

function esPermisoRestringido(codigo) {
	const c = String(codigo || '');
	return PREFIJOS_RESTRINGIDOS.some((p) => c.startsWith(p));
}

/** Descripción de un permiso `MODULO.SUBMODULO.ACCION`. */
function descripcionPermiso(codigo) {
	const [mod, sub, acc] = String(codigo || '').split('.');
	const propio = SUBMODULOS[`${mod}.${sub}`]?.acciones?.[acc];
	if (propio) return propio;
	const generica = ACCION_GENERICA[acc] || acc;
	const desc = SUBMODULOS[`${mod}.${sub}`]?.descripcion;
	return desc ? `${generica} — ${desc.replace(/\.$/, '')}` : generica;
}

/** Descripción de un submódulo. */
function descripcionSubmodulo(modId, subId) {
	return SUBMODULOS[`${modId}.${subId}`]?.descripcion || '';
}

/**
 * Catálogo completo para la pantalla de la matriz.
 * Excluye los módulos exclusivos de plataforma y marca los permisos
 * restringidos (no asignables a roles personalizados).
 */
function catalogoConDescripciones({ incluirPlataforma = false } = {}) {
	return MODULOS.filter((m) => incluirPlataforma || m.id !== 'PLATAFORMA').map((m) => ({
		id: m.id,
		label: m.label,
		submodulos: m.submodulos.map((s) => ({
			id: s.id,
			label: s.label,
			path: s.path || null,
			descripcion: descripcionSubmodulo(m.id, s.id),
			acciones: s.acciones.map((a) => {
				const codigo = `${m.id}.${s.id}.${a}`;
				return {
					accion: a,
					codigo,
					descripcion: descripcionPermiso(codigo),
					asignable: !esPermisoRestringido(codigo),
				};
			}),
		})),
	}));
}

module.exports = {
	ACCION_GENERICA,
	SUBMODULOS,
	PREFIJOS_RESTRINGIDOS,
	esPermisoRestringido,
	descripcionPermiso,
	descripcionSubmodulo,
	catalogoConDescripciones,
};
