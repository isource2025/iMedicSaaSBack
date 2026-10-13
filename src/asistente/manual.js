/**
 * Manual operativo de la plataforma. Se indexa en memoria (sin vectores).
 * El modelo busca acá para responder "cómo hago X".
 */
const { MODULOS } = require('../utils/permisos');
const rutasFront = require('./rutasFront');

const ARTICULOS = [
	{
		id: 'inicio',
		titulo: 'Panel de inicio',
		path: '/dashboard',
		modulo: 'DASHBOARD',
		tags: ['inicio', 'dashboard', 'resumen', 'métricas', 'ocupacion'],
		texto: 'El inicio muestra un resumen de ocupación, turnos y actividad. Se abre desde el logo o Dashboard en el menú lateral.',
	},
	{
		id: 'pacientes',
		titulo: 'Listado de pacientes',
		path: '/dashboard/patients',
		modulo: 'ADMISION',
		tags: ['paciente', 'padron', 'dni', 'historia', 'alta paciente', 'editar paciente'],
		texto: 'En Admisión → Pacientes se busca por nombre, documento o HC. Desde ahí se crea, edita o abre la ficha. La foto se carga en el formulario de alta/edición.',
	},
	{
		id: 'buscar-hc',
		titulo: 'Consultar historia clínica',
		path: '/dashboard/admission/search',
		modulo: 'ADMISION',
		tags: ['historia clinica', 'hc', 'visita', 'admision', 'buscar internacion', 'carpeta'],
		texto: 'Admisión → Consultar Historia Clínica busca visitas por DNI, nombre o fechas. Al abrir una visita se ve el detalle y se puede exportar. El botón flotante de carpeta también busca pacientes.',
	},
	{
		id: 'nueva-admision',
		titulo: 'Nueva admisión',
		path: '/dashboard/admission/new',
		modulo: 'ADMISION',
		tags: ['admitir', 'internar', 'ingreso', 'nueva admision', 'cama'],
		texto: 'Admisión → Nueva Admisión inicia un ingreso. Hay que identificar al paciente (o darlo de alta), completar datos de la visita y, si corresponde, asignar cama.',
	},
	{
		id: 'tabla-admisiones',
		titulo: 'Tabla de admisiones',
		path: '/dashboard/admission/tables',
		modulo: 'ADMISION',
		tags: ['tabla', 'exportar admisiones', 'listado visitas'],
		texto: 'Admisión → Tabla lista internaciones/admisiones para exportar o revisar en lote.',
	},
	{
		id: 'camas',
		titulo: 'Gestión de camas',
		path: '/dashboard/beds',
		modulo: 'INTERNACION',
		tags: ['cama', 'ocupacion', 'sector', 'mapa', 'internacion', 'estado cama'],
		texto: 'Internación → Camas muestra el mapa por sector. Se filtra por estado. Click en una cama abre el detalle clínico. El estado (libre, ocupada, etc.) se cambia desde la cama si se tiene permiso GESTIONAR.',
	},
	{
		id: 'detalle-cama',
		titulo: 'Detalle de cama / visita',
		path: '/dashboard/beds',
		modulo: 'INTERNACION',
		tags: ['evolucion', 'indicacion', 'epicrisis', 'signos', 'enfermeria', 'interconsulta', 'estudio'],
		texto: 'Dentro de una cama ocupada están las secciones clínicas: historia, indicaciones, evoluciones, enfermería, signos vitales, medicación, dieta, balance hídrico, estudios, protocolos, procedimientos, movimientos, adjuntos y epicrisis. Cada una pide su permiso.',
	},
	{
		id: 'traslados',
		titulo: 'Traslados y egreso',
		path: '/dashboard/beds',
		modulo: 'INTERNACION',
		tags: ['traslado', 'cambiar cama', 'egreso', 'alta', 'intercambio'],
		texto: 'Mover de cama, intercambiar o egresar se hace desde la cama (Movimientos). Hace falta INTERNACION.MOVIMIENTOS.TRASLADAR o GESTIONAR. El egreso no se puede deshacer sin permiso de gestión.',
	},
	{
		id: 'agenda',
		titulo: 'Agenda de turnos',
		path: '/dashboard/turnos/agenda',
		modulo: 'TURNOS',
		tags: ['turno', 'agenda', 'cita', 'reservar', 'horario', 'profesional'],
		texto: 'Turnos → Agenda muestra la grilla del profesional. Se elige fecha, servicio o especialidad y se asigna un slot. Los médicos suelen ver solo su matrícula.',
	},
	{
		id: 'admin-turnos',
		titulo: 'Administración de turnos',
		path: '/dashboard/turnos/admin',
		modulo: 'TURNOS',
		tags: ['cancelar turno', 'reagendar', 'admin turnos', 'sobreturno'],
		texto: 'Turnos → Admin lista turnos para gestionar (ver, editar, cancelar) según permiso TURNOS.ADMIN.',
	},
	{
		id: 'config-agenda',
		titulo: 'Configuración de agenda',
		path: '/dashboard/turnos/configuracion',
		modulo: 'TURNOS',
		tags: ['horario atencion', 'cupo', 'recurso', 'configurar agenda'],
		texto: 'Turnos → Configuración define horarios, recursos y cupos. Pedí TURNOS.CONFIGURACION.EDITAR para cambiarlos.',
	},
	{
		id: 'bandeja-pedidos',
		titulo: 'Bandeja de pedidos',
		path: '/dashboard/bandeja-pedidos',
		modulo: 'INTERNACION',
		tags: ['estudio', 'interconsulta', 'pedido', 'bandeja'],
		texto: 'La bandeja junta pedidos de estudios e interconsultas libres para aceptar. También se llega desde el botón de notificaciones.',
	},
	{
		id: 'almacen',
		titulo: 'Almacén y stock',
		path: '/dashboard/almacen',
		modulo: 'ALMACEN',
		tags: ['stock', 'deposito', 'articulo', 'proveedor', 'orden provision', 'insumo'],
		texto: 'Almacén tiene pestañas: stock, artículos, proveedores, solicitudes, órdenes, actas, movimientos y configuración. El ajuste de stock pide ALMACEN.STOCK.GESTIONAR.',
	},
	{
		id: 'facturacion',
		titulo: 'Facturación',
		path: '/dashboard/billing/rendiciones',
		modulo: 'FACTURACION',
		tags: ['rendicion', 'liquidacion', 'convenio', 'obra social', 'factura'],
		texto: 'Facturación cubre rendiciones y liquidaciones. Las tablas y exports piden FACTURACION.*.EXPORTAR.',
	},
	{
		id: 'personal',
		titulo: 'Personal',
		path: '/dashboard/personal',
		modulo: 'CONFIGURACION',
		tags: ['usuario', 'medico', 'matricula', 'empleado', 'cuenta', 'firma'],
		texto: 'Configuración → Personal da de alta profesionales, asigna sectores/servicios, crea cuenta de login y carga firma para PDFs.',
	},
	{
		id: 'permisos',
		titulo: 'Matriz de permisos',
		path: '/dashboard/configuracion/permisos',
		modulo: 'CONFIGURACION',
		tags: ['rol', 'permiso', 'acceso', 'matriz'],
		texto: 'Solo ADMIN/SUPER_ADMIN. Ahí se crean roles personalizados y se marcan códigos MODULO.SUBMODULO.ACCION. Los cambios no se aplican a roles de sistema.',
	},
	{
		id: 'consumo-ia',
		titulo: 'Consumo IA',
		path: '/dashboard/configuracion/consumo-ia',
		modulo: 'CONFIGURACION',
		tags: ['consumo', 'costo', 'tokens', 'openai', 'gasto', 'ia', 'dashboard de consumo'],
		texto: 'Configuración → Consumo IA muestra el costo real del asistente: total del período, proyección mensual, totalizador por usuario y detalle por mensaje. Pide CONFIGURACION.CONSUMO_IA.VER (ADMIN y SUPER_ADMIN lo tienen).',
	},
	{
		id: 'perfil',
		titulo: 'Mi perfil',
		path: '/dashboard/profile',
		modulo: 'USUARIO',
		tags: ['password', 'contraseña', 'perfil', 'datos personales'],
		texto: 'Mi Perfil permite ver datos de la sesión y cambiar la contraseña propia.',
	},
	{
		id: 'asistente',
		titulo: 'Asistente de la plataforma',
		path: '/dashboard',
		modulo: 'DASHBOARD',
		tags: ['chat', 'bot', 'ayuda', 'asistente'],
		texto: 'El asistente (botón de chat en la barra flotante derecha) responde cómo usar iMedic y puede consultar o proponer acciones que tu usuario ya tiene permitidas. Las acciones que modifican datos piden confirmación en pantalla.',
	},
];

function normalizar(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function score(art, q) {
	const nq = normalizar(q);
	if (!nq) return 0;
	let s = 0;
	if (normalizar(art.titulo).includes(nq)) s += 8;
	if (art.tags.some((t) => normalizar(t).includes(nq) || nq.includes(normalizar(t)))) s += 6;
	if (normalizar(art.texto).includes(nq)) s += 3;
	if (normalizar(art.path).includes(nq)) s += 2;
	const palabras = nq.split(/\s+/).filter((w) => w.length > 2);
	for (const w of palabras) {
		if (normalizar(art.titulo).includes(w)) s += 2;
		if (art.tags.some((t) => normalizar(t).includes(w))) s += 2;
		if (normalizar(art.texto).includes(w)) s += 1;
	}
	return s;
}

function buscar(pregunta, limite = 4) {
	const ranked = ARTICULOS.map((a) => ({ ...a, score: score(a, pregunta) }))
		.filter((a) => a.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limite);
	return ranked.map(({ score: _s, ...rest }) => rest);
}

function pantallasDesdePermisos(permisos) {
	const set = new Set(Array.isArray(permisos) ? permisos : []);
	const out = [];
	for (const mod of MODULOS) {
		if (mod.id === 'PLATAFORMA' && ![...set].some((p) => p.startsWith('PLATAFORMA.'))) continue;
		for (const sub of mod.submodulos) {
			if (!sub.path || !rutasFront.existe(sub.path)) continue;
			const codigoVer = `${mod.id}.${sub.id}.VER`;
			const codigoCrear = `${mod.id}.${sub.id}.CREAR`;
			const visible =
				set.has(codigoVer) ||
				set.has(codigoCrear) ||
				[...set].some((p) => p.startsWith(`${mod.id}.${sub.id}.`));
			if (!visible) continue;
			out.push({
				modulo: mod.label,
				pantalla: sub.label,
				path: sub.path,
			});
		}
	}
	return out;
}

module.exports = {
	ARTICULOS,
	buscar,
	pantallasDesdePermisos,
};
