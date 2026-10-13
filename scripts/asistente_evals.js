/**
 * Conversaciones de referencia del asistente contra el modelo real, con la base y la
 * API simuladas en memoria: no se conecta a ningún SQL ni ejecuta escrituras.
 * Sirve para cambiar prompts/router y ver al toque si algo se rompió.
 *
 *   node scripts/asistente_evals.js                 # todos los casos, una vez
 *   node scripts/asistente_evals.js --veces=3       # estabilidad: cada caso 3 veces
 *   node scripts/asistente_evals.js --caso=sanabria # solo los casos cuyo id contiene «sanabria»
 *
 * Necesita ASISTENTE_OPENAI_API_KEY (u OPENAI_API_KEY) en el entorno o en .env.
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// La base queda simulada: ningún módulo del asistente llega a abrir una conexión.
for (const k of Object.keys(process.env)) if (/^(DB_|AUTH_DB|MYSQL)/.test(k)) delete process.env[k];
delete process.env.ASISTENTE_INTERNACION_ESCRITURA;
delete process.env.ASISTENTE_INTERNACION_LISTO;

const src = (p) => path.join(__dirname, '..', 'src', p);

function stubModulo(rel, exports) {
	const p = require.resolve(src(rel));
	require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

/* ───────────── Datos de prueba ───────────── */

const INTERNADOS = [
	{ numeroVisita: 458887, paciente: 'SANABRIA ELIZABETH', documento: '35001268', sector: 'QUR2', sectorDescripcion: 'QUIRURGICO 2', cama: '04', diagnostico: 'NEUMONIA' },
	{ numeroVisita: 470001, paciente: 'MEZA GUSTAVO ADOLFO', documento: '20111222', sector: 'CM1', sectorDescripcion: 'CLINICA MEDICA 1', cama: '12', diagnostico: 'ICC' },
	{ numeroVisita: 404444, paciente: 'MIRANDA JUAN CARLOS', documento: '18333444', sector: 'UTI', sectorDescripcion: 'TERAPIA INTENSIVA', cama: '03', diagnostico: 'SEPSIS' },
	{ numeroVisita: 409100, paciente: 'UMBERT CARLOS', documento: '17555666', sector: 'CM2', sectorDescripcion: 'CLINICA MEDICA 2', cama: '07', diagnostico: 'EPOC' },
].map((i) => ({ ...i, idPaciente: i.numeroVisita + 1, hc: i.numeroVisita, ingreso: '01/10/2026', egresada: 0 }));

const porVisita = (nv) => INTERNADOS.find((i) => i.numeroVisita === Number(nv));

/** Imita el WHERE de clinica.whereClaves: DNI o visita exactos, o todos los LIKE del nombre. */
function filasInternados(sql, params) {
	if (!/imHabitacionCamas/i.test(sql) || /FechaEgreso AS int\), 0\) > 0/i.test(sql)) return [];
	const likes = params.filter((p) => typeof p.value === 'string' && p.value.startsWith('%')).map((p) => p.value.slice(1, -1).toLowerCase());
	const exactos = params.filter((p) => !String(p.value).startsWith('%')).map((p) => String(p.value));
	return INTERNADOS.filter(
		(i) =>
			exactos.includes(i.documento) ||
			exactos.includes(String(i.numeroVisita)) ||
			(likes.length && likes.every((t) => i.paciente.toLowerCase().includes(t))),
	);
}

stubModulo('models/db.js', {
	executeQuery: async (sql, params = []) => filasInternados(String(sql), params),
	getRequestPool: async () => ({}),
	sql: {},
});
stubModulo('services/auditoria.service.js', { registrar: async () => {}, registrarEvento: async () => {} });

const ESTUDIOS_SANABRIA = [
	{
		SectorReceptorNombre: 'RAYOS',
		MedicoSolicitanteNombre: 'PEREZ ANA',
		FechaPedido: '2026-10-03',
		Items: [
			{ PracticaSolicitada: 'RX DE TORAX FRENTE', Cumplido: 1, FechaResultado: '2026-10-04', TextoResultado: 'Infiltrado basal derecho.' },
			{ PracticaSolicitada: 'TC DE TORAX SIN CONTRASTE', Cumplido: 0 },
		],
	},
];

function respuestaApi(req) {
	const p = req.path;
	let m = p.match(/^\/api\/patients\/visitas\/(\d+)\/contexto-clinico$/);
	if (m) {
		const i = porVisita(m[1]);
		if (!i) return { status: 404, body: { mensaje: 'Visita inexistente' } };
		return {
			status: 200,
			body: {
				data: {
					NombrePaciente: i.paciente,
					documentoPaciente: i.documento,
					sector: i.sector,
					numeroCama: i.cama,
					egresada: false,
					DiagnosticoDescripcion: i.diagnostico,
					fechaIngresoSQL: '2026-10-01',
				},
			},
		};
	}
	m = p.match(/^\/api\/solicitudes-estudios\/visita\/(\d+)$/);
	if (m) return { status: 200, body: { data: Number(m[1]) === 458887 ? ESTUDIOS_SANABRIA : [] } };
	if (/^\/api\/evoluciones\/\d+\/byDate$/.test(p)) return { status: 200, body: { data: [] } };
	if (/^\/api\/indicaciones\/(\d+\/byDate|ultimas\/\d+)$/.test(p)) return { status: 200, body: { data: [] } };
	return { status: 404, body: { mensaje: `Sin dato de prueba para ${req.method} ${p}` } };
}

const httpInterno = require(src('asistente/httpInterno'));
httpInterno.llamar = async (req) => {
	if (String(req.method).toUpperCase() !== 'GET') throw new Error(`Las evals no ejecutan escrituras (${req.method} ${req.path})`);
	return respuestaApi(req);
};

const contexto = require(src('asistente/contexto'));
const autoria = require(src('asistente/autoria'));
const auditoria = require(src('asistente/auditoria'));
const openai = require(src('asistente/openai'));
const sesion = require(src('asistente/sesion'));
const pendientes = require(src('asistente/pendientes'));
const matriz = require(src('utils/permisos'));
const controller = require(src('asistente/controller'));

autoria.esAdmin = async () => false;
auditoria.registrarUso = async () => {};

/* ───────────── Casos ───────────── */

const MEDICO = matriz.permisosDeRol('MEDICO');
const SIN_CREAR_EVOLUCION = MEDICO.filter((p) => p !== 'INTERNACION.EVOLUCIONES.CREAR');

/**
 * espera: tools (todas deben aparecer), noTools, args (nombre → fn(args) que devuelve true),
 * texto / noTexto (regex), pendientes (cantidad), navega (href que debe aparecer).
 */
const CASOS = [
	{
		id: 'soporte-error-permiso',
		descripcion: '«No me deja guardar» con el 403 de la API en pantalla',
		permisos: SIN_CREAR_EVOLUCION,
		turnos: [
			{
				mensaje: 'no me deja guardar la evolución',
				ruta: '/dashboard/visita/458887?seccion=evoluciones',
				pantalla: {
					errores: [
						{ metodo: 'POST', path: '/api/evoluciones', status: 403, mensaje: 'Permiso requerido: INTERNACION.EVOLUCIONES.CREAR', haceSeg: 30 },
					],
				},
				espera: {
					tools: ['diagnosticar'],
					noTools: ['preparar_evolucion'],
					texto: [/permiso/i, /administrador|matriz de permisos/i],
					pendientes: 0,
				},
			},
		],
	},
	{
		id: 'soporte-como-cargar',
		descripcion: 'Pregunta de uso con palabra clínica: manual, sin cargar nada',
		turnos: [
			{
				mensaje: '¿cómo cargo una evolución?',
				ruta: '/dashboard',
				espera: { tools: ['buscar_en_manual'], noTools: ['preparar_evolucion'], pendientes: 0 },
			},
		],
	},
	{
		id: 'soporte-que-es',
		descripcion: '«Qué es una epicrisis» no arma una epicrisis',
		turnos: [
			{
				mensaje: 'qué es una epicrisis?',
				ruta: '/dashboard',
				espera: { noTools: ['preparar_epicrisis'], pendientes: 0, texto: [/epicrisis/i] },
			},
		],
	},
	{
		id: 'soporte-navegar',
		descripcion: 'Llevar al mapa de camas',
		turnos: [
			{
				mensaje: 'llevame al mapa de camas',
				ruta: '/dashboard',
				espera: { tools: ['navegar'], navega: '/dashboard/beds', pendientes: 0 },
			},
		],
	},
	{
		id: 'soporte-exportar-sin-permiso',
		descripcion: 'Médico sin permiso de exportar: diagnóstico y quién lo habilita',
		turnos: [
			{
				mensaje: 'por qué no puedo exportar la tabla de internación?',
				ruta: '/dashboard/beds/tables',
				espera: { tools: ['diagnosticar'], texto: [/administrador|matriz de permisos/i], pendientes: 0 },
			},
		],
	},
	{
		id: 'sanabria-desde-inicio',
		descripcion: 'Caso Sanabria sin estar en el mapa de camas, y estudios hechos',
		turnos: [
			{
				mensaje: 'dónde está Sanabria',
				ruta: '/dashboard',
				espera: {
					tools: ['buscar_internado'],
					args: { buscar_internado: (a) => /sanabria/i.test(a.termino || '') },
					texto: [/458887/, /QUR2|QUIRURGICO/i],
				},
			},
			{
				mensaje: 'resumen de los estudios ya hechos',
				ruta: '/dashboard',
				espera: {
					tools: ['ver_estudios'],
					args: { ver_estudios: (a) => a.filtro === 'hechos' },
					texto: [/RX/i],
					noTools: ['buscar_codigo', 'llamar_api'],
				},
			},
		],
	},
	{
		id: 'estado-paciente',
		descripcion: '«Cómo sigue Sanabria» es clínico, no un pedido de ayuda',
		turnos: [
			{
				mensaje: 'cómo sigue Sanabria?',
				ruta: '/dashboard',
				espera: { tools: ['buscar_internado'], noTools: ['buscar_en_manual'] },
			},
		],
	},
	{
		id: 'umbert-en-pantalla-de-miranda',
		descripcion: 'Incidente 12/10: egreso pedido por nombre con otro paciente en pantalla (modo altas: no habilitado)',
		turnos: [
			{
				mensaje: 'egresemos a umbert',
				ruta: '/dashboard/visita/404444',
				pantalla: { internado: { numeroVisita: 404444, paciente: 'MIRANDA JUAN CARLOS', sector: 'UTI', cama: '03' } },
				espera: { noTools: ['preparar_egreso'], pendientes: 0, texto: [/no est[aá] habilitad/i], noTexto: [/MIRANDA.*(egres|alta)/i] },
			},
		],
	},
	{
		id: 'evolucion-meza',
		descripcion: 'Alta del menú médico: tarjeta para el paciente nombrado, sin decir «cargué»',
		turnos: [
			{
				mensaje: 'evolucioná a Meza: paciente estable, afebril, tolera la dieta',
				ruta: '/dashboard/beds',
				espera: {
					tools: ['preparar_evolucion'],
					pendientes: 1,
					pendienteDe: /MEZA/,
					noTexto: [/\bcargu[eé]\b|se ha registrado|registr[eé]\b|qued[oó] cargad/i],
				},
			},
		],
	},
	{
		id: 'turnos-no-activo',
		descripcion: 'Acción de un módulo que no opera: no inventa el turno',
		turnos: [
			{
				mensaje: 'dame un turno para mañana con cardiología para Meza',
				ruta: '/dashboard',
				espera: { pendientes: 0, noTexto: [/(te )?(di|agend[eé]|reserv[eé]) (el|un) turno/i] },
			},
		],
	},
];

/* ───────────── Runner ───────────── */

function argumento(nombre, def) {
	const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
	return a ? a.split('=').slice(1).join('=') : def;
}

function reqFalso({ mensaje, ruta, pantalla, idConversacion, permisos }) {
	return {
		body: { mensaje, rutaActual: ruta, idConversacion, pantalla: { url: ruta, ...(pantalla || {}) }, debug: true },
		headers: { authorization: 'Bearer eval' },
		ip: '127.0.0.1',
		idEmpresa: 1,
		valorPersonal: 900,
		rolNombre: 'MEDICO',
		matricula: 4521,
		auth: { usuario: { apellido: 'EVAL', nombre: 'Médico', codOperador: 900 } },
		_permisosEval: permisos,
	};
}

async function turno(req) {
	let status = 200;
	let cuerpo = null;
	const res = {
		status(s) {
			status = s;
			return this;
		},
		json(b) {
			cuerpo = b;
			return this;
		},
	};
	await controller.mensaje(req, res);
	return { status, cuerpo };
}

function revisar(espera, r) {
	const fallas = [];
	const usadas = (r.traza || []).map((t) => t.nombre);
	for (const t of espera.tools || []) if (!usadas.includes(t)) fallas.push(`no llamó ${t}`);
	for (const t of espera.noTools || []) if (usadas.includes(t)) fallas.push(`llamó ${t}`);
	for (const [nombre, ok] of Object.entries(espera.args || {})) {
		const llamadas = (r.traza || []).filter((t) => t.nombre === nombre);
		if (llamadas.length && !llamadas.some((t) => ok(t.args || {}))) fallas.push(`${nombre} con args inesperados: ${JSON.stringify(llamadas.map((t) => t.args))}`);
	}
	const texto = String(r.texto || '');
	for (const re of espera.texto || []) if (!re.test(texto)) fallas.push(`el texto no cumple ${re}`);
	for (const re of espera.noTexto || []) if (re.test(texto)) fallas.push(`el texto cumple ${re}`);
	const pend = r.pendientes || [];
	if (espera.pendientes != null && pend.length !== espera.pendientes) fallas.push(`${pend.length} tarjetas (esperaba ${espera.pendientes})`);
	if (espera.pendienteDe && !pend.some((p) => espera.pendienteDe.test(p.resumen || ''))) fallas.push(`ninguna tarjeta es de ${espera.pendienteDe}`);
	if (espera.navega && !(r.navegaciones || []).some((n) => String(n.href).startsWith(espera.navega))) fallas.push(`no navegó a ${espera.navega}`);
	return { fallas, usadas };
}

async function correrCaso(caso) {
	sesion.resetStore();
	pendientes.resetStore();
	let idConversacion = null;
	const salida = [];
	for (const t of caso.turnos) {
		const req = reqFalso({ ...t, idConversacion, permisos: caso.permisos || MEDICO });
		const { status, cuerpo } = await turno(req);
		if (status >= 400 || !cuerpo?.success) {
			salida.push({ mensaje: t.mensaje, fallas: [`HTTP ${status}: ${cuerpo?.mensaje || 'sin cuerpo'}`], usadas: [], texto: '' });
			break;
		}
		idConversacion = cuerpo.idConversacion;
		const { fallas, usadas } = revisar(t.espera || {}, cuerpo);
		salida.push({ mensaje: t.mensaje, fallas, usadas, texto: cuerpo.texto, paquetes: cuerpo.paquetes, costo: cuerpo.consumo?.costoUsd });
	}
	return salida;
}

async function main() {
	if (!openai.isConfigured()) {
		console.error('Falta ASISTENTE_OPENAI_API_KEY / OPENAI_API_KEY: las evals corren contra el modelo real.');
		process.exit(2);
	}
	contexto.permisosDeReq = async (req) => req._permisosEval || MEDICO;

	const veces = Math.max(1, Number(argumento('veces', 1)) || 1);
	const filtro = argumento('caso', '');
	const casos = CASOS.filter((c) => !filtro || c.id.includes(filtro));
	console.log(`Modelo ${openai.getModel()} · ${casos.length} casos × ${veces}\n`);

	let ok = 0;
	let total = 0;
	let costo = 0;
	const inestables = [];
	for (const caso of casos) {
		let verdes = 0;
		for (let n = 1; n <= veces; n++) {
			total += 1;
			const turnos = await correrCaso(caso);
			const fallo = turnos.some((t) => t.fallas.length);
			if (!fallo) verdes += 1;
			for (const t of turnos) costo += Number(t.costo) || 0;
			const marca = fallo ? '✘' : '✔';
			console.log(`${marca} ${caso.id}${veces > 1 ? ` (#${n})` : ''} — ${caso.descripcion}`);
			for (const t of turnos) {
				console.log(`    «${t.mensaje}» → [${(t.paquetes || []).join('+')}] ${t.usadas.join(', ') || '(sin tools)'}`);
				if (t.fallas.length) {
					for (const f of t.fallas) console.log(`      · ${f}`);
					console.log(`      respuesta: ${String(t.texto || '').replace(/\s+/g, ' ').slice(0, 220)}`);
				}
			}
		}
		ok += verdes;
		if (verdes && verdes < veces) inestables.push(`${caso.id} ${verdes}/${veces}`);
	}
	console.log(`\n${ok}/${total} en verde · costo ≈ USD ${costo.toFixed(4)}`);
	if (inestables.length) console.log(`Inestables: ${inestables.join(', ')}`);
	process.exit(ok === total ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
