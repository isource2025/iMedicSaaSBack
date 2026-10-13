/**
 * Ida/vuelta del módulo INTERNACION contra el backend vivo (con modelo).
 *
 *   ASISTENTE_INTERNACION_LISTO=1 npm start          (backend apuntando a una COPIA)
 *   node scripts/asistente_internacion.js
 *
 * R: buscar_internado, ver_estudios (hechos), ver_evoluciones, ver_indicaciones,
 *    ver_movimientos, listar_camas_libres, ver_historia_clinica (análisis, signos, medicación).
 *    Si una lectura vino resumida, la respuesta tiene que traer `disclaimer`.
 * Por defecto (backend sin ASISTENTE_INTERNACION_ESCRITURA) el agente lee y prepara las altas
 * del menú médico (evolución, HC de ingreso, indicación no medicamentosa, estudios,
 * interconsulta, protocolo, epicrisis): cada tarjeta se CANCELA. Egreso, traslados y revertir
 * no pueden usar tools ni dejar tarjeta. TEST_ESCRITURA=1 (backend con =1) prueba también esas
 * tarjetas; TEST_ESCRITURA=0 (backend con =0) exige solo lectura.
 * Nunca confirma. Se niega a correr si el .env apunta a la BD del hospital.
 *
 * Variables: TEST_LOGIN_USER, TEST_LOGIN_PASSWORD, TEST_LOGIN_EMPRESA,
 * TEST_INTERNADO (default "Sanabria Elizabeth"), TEST_MOTIVO_EGRESO (default "alta medica").
 * Opcionales: TEST_CAMA_DESTINO (cama libre, ej. "01 de clinica medica 1") y
 * TEST_EGRESADO (paciente egresado) suman traslado y revertir egreso, también cancelados.
 */
require('dotenv').config();

const HOSTS_PRODUCCION = ['181.4.71.230'];
if (HOSTS_PRODUCCION.includes(String(process.env.DB_SERVER || '').trim())) {
	console.error(`FAIL INTERNACION: DB_SERVER=${process.env.DB_SERVER} es la base del hospital. Usá una copia.`);
	process.exit(1);
}

const BASE = `http://127.0.0.1:${process.env.PORT || 5006}`;
const USER = process.env.TEST_LOGIN_USER || 'adminvidal';
const PASS = process.env.TEST_LOGIN_PASSWORD || 'admin@vidal';
const ID_EMPRESA = Number(process.env.TEST_LOGIN_EMPRESA || 1);
const INTERNADO = process.env.TEST_INTERNADO || 'Sanabria Elizabeth';
const MOTIVO = process.env.TEST_MOTIVO_EGRESO || 'alta medica';
const CAMA_DESTINO = process.env.TEST_CAMA_DESTINO || '';
const EGRESADO = process.env.TEST_EGRESADO || '';

function ok(cond, msg) {
	if (!cond) throw new Error(msg);
	console.log(`  OK  ${msg}`);
}

async function request(method, path, { token, body } = {}) {
	const resp = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await resp.json().catch(() => ({}));
	return { status: resp.status, data };
}

async function login() {
	const emp = await request('GET', `/api/auth/empresas/${encodeURIComponent(USER)}`);
	const idEmpresa = emp.data?.data?.[0]?.idEmpresa ?? emp.data?.[0]?.idEmpresa ?? ID_EMPRESA;
	const r = await request('POST', '/api/auth/login', { body: { username: USER, password: PASS, idEmpresa } });
	if (r.status !== 200 || !r.data?.token) {
		throw new Error(`Login falló (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
	}
	return r.data.token;
}

/** Tiene que coincidir con ASISTENTE_INTERNACION_ESCRITURA del backend. */
const MODO = { 1: 'todo', 0: 'lectura' }[process.env.TEST_ESCRITURA] || 'altas';
const TOOLS_EDICION = ['preparar_egreso', 'editar_evolucion', 'eliminar_evolucion', 'trasladar_cama', 'asignar_cama', 'revertir_egreso'];
const TOOLS_ALTAS = [
	'preparar_evolucion',
	'preparar_hc_ingreso',
	'preparar_indicacion',
	'solicitar_estudios',
	'solicitar_interconsulta',
	'preparar_protocolo',
	'preparar_epicrisis',
];
const TOOLS_PROHIBIDAS = MODO === 'lectura' ? [...TOOLS_EDICION, ...TOOLS_ALTAS] : TOOLS_EDICION;
const APELLIDO = INTERNADO.split(/\s+/)[0].toUpperCase();

const LECTURA = [
	{ id: 'read-buscar', mensaje: `dónde está internada ${INTERNADO}`, esperarTool: 'buscar_internado' },
	{ id: 'read-estudios', mensaje: 'resumen de los estudios ya hechos', esperarTool: 'ver_estudios', filtro: 'hechos' },
	{ id: 'read-evoluciones', mensaje: 'y las evoluciones de los últimos días', esperarTool: 'ver_evoluciones' },
	{ id: 'read-indicaciones', mensaje: 'qué indicaciones tiene hoy', esperarTool: 'ver_indicaciones' },
	{ id: 'read-signos', mensaje: 'cómo vienen los signos vitales en toda la internación', esperarTool: 'ver_historia_clinica', mostrar: 1500 },
	{ id: 'read-medicacion', mensaje: 'qué medicación recibió', esperarTool: 'ver_historia_clinica', mostrar: 1500 },
	{
		id: 'read-evol-todas',
		mensaje: 'resumime todas las evoluciones de la internación',
		esperarTool: 'ver_evoluciones',
		soloTools: ['ver_evoluciones'],
		mostrar: 1500,
	},
	{
		id: 'read-analisis',
		mensaje: 'haceme un análisis clínico de la internación: ingreso, signos vitales, medicación y enfermería',
		esperarTool: 'ver_historia_clinica',
		maxLlamadas: 2,
		mostrar: 2500,
	},
	{ id: 'create-nav', mensaje: 'abrime la historia clínica en evoluciones', esperarTool: 'navegar' },
	{ id: 'read-movimientos', mensaje: 'mostrame los movimientos de cama de la internación', esperarTool: 'ver_movimientos' },
	{ id: 'read-camas', mensaje: 'qué camas libres hay en el hospital', esperarTool: 'listar_camas_libres' },
];

const ESCRITURAS = [
	{ id: 'update-traslado', mensaje: `quiero trasladar a ${INTERNADO} de cama`, esperarTool: ['trasladar_cama', 'listar_camas_libres'] },
	{
		id: 'create-evolucion',
		mensaje: `cargale una evolución a ${INTERNADO}: paciente estable, afebril, tolera dieta`,
		esperarTool: 'preparar_evolucion',
		cancelar: true,
	},
	{ id: 'update-egreso', mensaje: `egresar a ${INTERNADO} por ${MOTIVO}`, esperarTool: 'preparar_egreso', cancelar: true },
	...(CAMA_DESTINO
		? [{ id: 'update-traslado-cama', mensaje: `trasladá a ${INTERNADO} a la cama ${CAMA_DESTINO}`, esperarTool: 'trasladar_cama', cancelar: true }]
		: []),
	...(EGRESADO
		? [{ id: 'delete-revertir', mensaje: `revertí el egreso de ${EGRESADO}, fue por error`, esperarTool: 'revertir_egreso', cancelar: true }]
		: []),
];

/** Altas del menú médico. El primer par reproduce «evolución a Pérez» → «era Franco Matías». */
const ALTAS = [
	{ id: 'alta-evolucion-otro', mensaje: 'cargá una evolución a Zzyzxquo: paciente estable, afebril, buena tolerancia oral', sinTarjeta: true },
	{ id: 'alta-evolucion-corrige', mensaje: `perdón, era ${INTERNADO}`, esperarTool: 'preparar_evolucion', cancelar: true },
	{ id: 'alta-indicacion', mensaje: 'indicale control de signos vitales cada 8 horas', esperarTool: 'preparar_indicacion', cancelar: true },
	{ id: 'alta-indicacion-med', mensaje: 'indicale ceftriaxona 1 g endovenosa cada 12 horas', sinTarjeta: true, texto: /medicaci|pantalla|indicaciones/i },
	{ id: 'alta-estudio', mensaje: 'pedile una rx de tórax frente', esperarTool: 'solicitar_estudios', cancelar: true },
	{
		id: 'alta-interconsulta',
		mensaje: 'pedí una interconsulta a cardiología por fibrilación auricular de reciente comienzo',
		esperarTool: 'solicitar_interconsulta',
		cancelar: true,
	},
	{
		id: 'alta-hc',
		mensaje: 'cargale la HC de ingreso: motivo disnea; enfermedad actual: disnea de 3 días con tos productiva; TA 130/80, FC 96',
		esperarTool: 'preparar_hc_ingreso',
		cancelar: true,
	},
	{
		id: 'alta-protocolo',
		mensaje: 'cargá el protocolo de una punción lumbar: se realiza punción lumbar en L3-L4 sin complicaciones, líquido claro',
		esperarTool: 'preparar_protocolo',
		cancelar: 'si-hay',
	},
	{
		id: 'alta-epicrisis',
		mensaje: 'armá la epicrisis: internado por neumonía, buena evolución con antibióticos, alta a domicilio',
		esperarTool: 'preparar_epicrisis',
		cancelar: true,
	},
];

/** Pedidos que el modo no habilita: sin tool de escritura, sin tarjeta, y lo dice. */
const bloqueados = (lista) => lista.map((t) => ({ id: t.id.replace(/^\w+-/, 'ro-'), mensaje: t.mensaje, soloLectura: true }));

/** Misma conversación: cada turno depende del foco que dejó el anterior. */
const TURNOS = {
	todo: [...LECTURA, ...ALTAS, ...ESCRITURAS.filter((t) => t.id !== 'create-evolucion')],
	altas: [...LECTURA, ...ALTAS, ...bloqueados(ESCRITURAS.filter((t) => t.id !== 'create-evolucion'))],
	lectura: [...LECTURA, ...bloqueados(ESCRITURAS)],
}[MODO];

const URL_INVENTADA = /https?:\/\//i;
let ultimoTexto = null;
const TUTEO = /\b(aqu[ií] tienes|h[aá]zmelo|ind[ií]came|puedes|necesitas)\b/i;

async function main() {
	const health = await fetch(`${BASE}/api/health`).catch(() => null);
	if (!health || !health.ok) throw new Error(`Backend no está en ${BASE}`);

	console.log('\n=== INTERNACION chat vivo (ida/vuelta con modelo) ===\n');
	const token = await login();
	const caps = await request('GET', '/api/asistente/capacidades', { token });
	ok(caps.status === 200, `capacidades HTTP ${caps.status}`);
	ok(
		caps.data?.agentes?.some((a) => a.id === 'INTERNACION' && a.listo),
		'agente INTERNACION listo (backend levantado con ASISTENTE_INTERNACION_LISTO=1)',
	);

	const ses = await request('POST', '/api/asistente/sesion', { token, body: { rutaActual: '/dashboard/beds' } });
	const idConversacion = ses.data?.idConversacion;
	ok(Boolean(idConversacion), 'CREATE sesión');

	const corridas = [];
	for (const t of TURNOS) {
		const t0 = Date.now();
		const r = await request('POST', '/api/asistente/mensaje', {
			token,
			body: { mensaje: t.mensaje, rutaActual: '/dashboard/beds', idConversacion, debug: true, pantalla: { url: '/dashboard/beds' } },
		});
		ok(r.status === 200 && r.data?.success, `${t.id} HTTP ${r.status}`);
		ok(r.data.agente === 'INTERNACION', `${t.id} agente=${r.data.agente}`);
		const tools = r.data.herramientas || [];
		const traza = r.data.traza || [];
		const texto = String(r.data.texto || '');
		const iUrl = texto.search(URL_INVENTADA);
		ultimoTexto =
			`${t.id}: «${iUrl >= 0 ? `…${texto.slice(Math.max(0, iUrl - 200), iUrl + 200)}…` : texto.slice(0, 800)}»\n` +
			`  tools: ${JSON.stringify(traza.map((p) => ({ tool: p.nombre, args: p.args })))}`;
		ok(!tools.includes('llamar_api') && !tools.includes('buscar_endpoints'), `${t.id} sin primitivas de API`);
		if (t.sinTarjeta) {
			ok(!(r.data.pendientes || []).length, `${t.id} no dejó tarjeta`);
			if (t.texto) ok(t.texto.test(texto), `${t.id} lo explica (${t.texto})`);
			corridas.push({ id: t.id, tools, texto: texto.slice(0, 400) });
			console.log(`\n--- ${t.id} ---\n${JSON.stringify({ tools, texto: texto.slice(0, 400) }, null, 2)}`);
			continue;
		}
		if (t.soloLectura) {
			const escritas = tools.filter((n) => TOOLS_PROHIBIDAS.includes(n));
			ok(!escritas.length, `${t.id} no usó tools de escritura (fue: ${tools.join(',') || 'ninguna'})`);
			ok(!(r.data.pendientes || []).length, `${t.id} no dejó tarjeta`);
			ok(/habilitad|todav[ií]a no|no (puedo|está)|pantalla/i.test(texto), `${t.id} explica que no se hace desde el chat`);
			corridas.push({ id: t.id, tools, texto: texto.slice(0, 400) });
			console.log(`\n--- ${t.id} ---\n${JSON.stringify({ tools, texto: texto.slice(0, 400) }, null, 2)}`);
			continue;
		}
		const esperadas = [].concat(t.esperarTool);
		const usada = esperadas.find((n) => tools.includes(n));
		ok(Boolean(usada), `${t.id} usó ${esperadas.join(' o ')} (fue: ${tools.join(',') || 'ninguna'})`);
		if (t.soloTools) {
			const extra = tools.filter((x) => !t.soloTools.includes(x));
			ok(!extra.length, `${t.id} no trajo de más (extra: ${extra.join(',') || 'nada'})`);
		}
		if (t.maxLlamadas) {
			const n = tools.filter((x) => x === usada).length;
			if (n > t.maxLlamadas) console.log(`  WARN ${t.id} ${usada} llamada ${n} veces (ideal ≤ ${t.maxLlamadas})`);
			const chars = traza.reduce((s, p) => s + JSON.stringify(p.resultado ?? null).length, 0);
			ok(chars <= 9000, `${t.id} lecturas del turno suman ${chars} chars (máx. 9000)`);
		}
		const resumida = traza.some((p) => p.resultado?.resumido || p.resultado?.truncado === true);
		ok(!resumida || Boolean(r.data.disclaimer), `${t.id} con datos resumidos lleva disclaimer`);
		ok(!traza.some((p) => p.resultado?.muestra), `${t.id} ninguna lectura pasó por el corte genérico`);
		if (/resumen autom[aá]tico/i.test(texto)) console.log(`  WARN ${t.id} el modelo escribió su propio aviso de resumen`);
		ok(!URL_INVENTADA.test(texto), `${t.id} sin URLs en el texto`);
		if (TUTEO.test(texto)) console.log(`  WARN ${t.id} usa tuteo: «${texto.match(TUTEO)[0]}»`);
		const fallo = traza.find((p) => p.nombre === usada && p.resultado?.error);
		if (t.cancelar === 'si-hay' && fallo) console.log(`  WARN ${t.id} ${usada}: ${fallo.resultado.error}`);
		else ok(!fallo, `${t.id} ${usada} sin error${fallo ? `: ${fallo.resultado.error}` : ''}`);
		if (t.id === 'read-indicaciones') ok(!/estudio/i.test(texto), 'read-indicaciones no responde con estudios');
		if (t.cancelar === true) {
			ok((r.data.pendientes || []).length >= 1, `${t.id} dejó tarjeta Confirmar`);
			const ajena = (r.data.pendientes || []).find((p) => !String(p.resumen).toUpperCase().includes(APELLIDO));
			ok(!ajena, `${t.id} la tarjeta es de ${APELLIDO}${ajena ? ` (fue: ${ajena.resumen})` : ''}`);
		}
		if (t.filtro) {
			const paso = traza.find((p) => p.nombre === usada);
			ok(paso?.args?.filtro === t.filtro, `${t.id} filtro=${paso?.args?.filtro}`);
		}
		if (t.cancelar) {
			for (const p of r.data.pendientes || []) {
				const c = await request('POST', '/api/asistente/cancelar', { token, body: { idPendiente: p.id, idConversacion } });
				ok(c.data?.success, `DELETE cancelar pendiente ${p.id} (${p.resumen})`);
			}
		}
		const paso = {
			id: t.id,
			ms: Date.now() - t0,
			tools,
			navegaciones: (r.data.navegaciones || []).map((n) => n.href),
			pendientes: (r.data.pendientes || []).map((p) => p.resumen),
			texto: String(r.data.texto || '').slice(0, t.mostrar || 400),
			disclaimer: r.data.disclaimer || null,
			traza: traza.map((p) => ({ tool: p.nombre, args: p.args, error: p.resultado?.error || null })),
			consumo: r.data.consumo || null,
		};
		corridas.push(paso);
		console.log(`\n--- ${t.id} ---\n${JSON.stringify(paso, null, 2)}`);
	}

	console.log(`\n=== INTERNACION OK (modo ${MODO}): ninguna tarjeta confirmada. ===\n`);
}

main().catch((err) => {
	console.error('\nFAIL INTERNACION', err.message || err);
	if (ultimoTexto) console.error(`  texto ${ultimoTexto}`);
	process.exit(1);
});
