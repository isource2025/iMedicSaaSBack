/**
 * Ahorro de llamadas y tokens: censo en memoria con búsqueda tolerante, intención del mensaje,
 * respuestas directas (sin segunda llamada al modelo) y las lecturas compuestas de Internación.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

let censoFilas = [];
let consultasDb = [];
const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql, params = []) => {
			consultasDb.push({ sql: String(sql), params });
			if (/asistente:censo/.test(sql)) return censoFilas;
			return [];
		},
		getRequestPool: async () => ({}),
		sql: {},
	},
};

const censo = require(src('asistente/censo'));
const clinica = require(src('asistente/clinica'));
const intencion = require(src('asistente/intencion'));
const directas = require(src('asistente/directas'));
const guardia = require(src('asistente/guardia'));
const { agenteLoop } = require(src('asistente/loop'));
const httpInterno = require(src('asistente/httpInterno'));
const contexto = require(src('asistente/contexto'));
const permisosService = require(src('services/permisos.service'));
const { ejecutar } = require(src('asistente/ejecutar'));

const llamarOriginal = httpInterno.llamar;
let llamadasHttp = [];

const fila = (o) => ({
	numeroVisita: o.nv,
	idPaciente: o.nv + 1,
	paciente: o.paciente,
	documento: o.dni || String(30000000 + o.nv),
	hc: o.nv,
	ingreso: '10/10/2026',
	ingresoIso: o.ingresoIso || '2026-10-10',
	diagnostico: o.dx || 'NEUMONIA',
	sector: o.sector || 'QUR2',
	sectorDescripcion: o.desc || 'QUIRURGICO 2',
	cama: o.cama,
});

const CENSO = [
	fila({ nv: 458887, paciente: 'SANABRIA ELIZABETH', dni: '35001268', cama: '105' }),
	fila({ nv: 458900, paciente: 'MEZA FRANCO MATIAS', cama: '102', dx: 'APENDICITIS' }),
	fila({ nv: 458901, paciente: 'GOMEZ ANA', cama: '3', sector: 'UTI', desc: 'TERAPIA INTENSIVA' }),
	fila({ nv: 458902, paciente: 'GOMEZ ANALIA', cama: '4', sector: 'UTI', desc: 'TERAPIA INTENSIVA' }),
];

const PERMISOS = ['INTERNACION.CAMAS.VER', 'INTERNACION.EVOLUCIONES.VER', 'INTERNACION.ESTUDIOS.VER', 'INTERNACION.INDICACIONES.VER'];

function ctxBase(extra) {
	return {
		permisos: PERMISOS,
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: 1,
		valorPersonal: 10,
		token: 't',
		req: { headers: {} },
		conv: {},
		foco: null,
		entidades: {},
		navegaciones: [],
		pendientes: [],
		consultas: [],
		inserciones: [],
		traza: [],
		...extra,
	};
}

function stubHttp(fn) {
	llamadasHttp = [];
	httpInterno.llamar = async (req) => {
		llamadasHttp.push(req);
		return fn(req) || { status: 200, body: { data: [] } };
	};
}

test.beforeEach(() => {
	censo._reset();
	censoFilas = CENSO;
	consultasDb = [];
});

test.afterEach(() => {
	httpInterno.llamar = llamarOriginal;
});

/* ───────────── censo ───────────── */

test('censo: una sola query por empresa mientras dura la caché; invalidar la refresca', async () => {
	await censo.obtener(1);
	await censo.obtener(1);
	await Promise.all([censo.obtener(2), censo.obtener(2)]);
	assert.equal(consultasDb.length, 2, 'una por empresa, también con pedidos simultáneos');
	censo.invalidar(1);
	await censo.obtener(1);
	assert.equal(consultasDb.length, 3);
	assert.match(consultasDb[0].sql, /FechaEgreso AS int\), 0\) = 0/);
});

test('censo: búsqueda exacta, por DNI, y tolerante a errores de tipeo', () => {
	const filas = CENSO.map((f) => ({ ...f, _palabras: censo.normalizar(f.paciente).split(' ') }));
	const claves = (t) => clinica.extraerClavesBusqueda(t);
	assert.deepEqual(censo.buscar(filas, claves('sanabria')).exactos.map((f) => f.numeroVisita), [458887]);
	assert.deepEqual(censo.buscar(filas, claves('35001268')).exactos.map((f) => f.numeroVisita), [458887]);
	const tipeo = censo.buscar(filas, claves('Sanabira'));
	assert.equal(tipeo.exactos.length, 0);
	assert.deepEqual(tipeo.aproximados.map((f) => f.paciente), ['SANABRIA ELIZABETH']);
	assert.deepEqual(censo.buscar(filas, claves('mesa franco')).aproximados.map((f) => f.paciente), ['MEZA FRANCO MATIAS']);
	assert.equal(censo.buscar(filas, claves('perez')).aproximados.length, 0, 'sin parecido no inventa');
	assert.equal(censo.buscar(filas, claves('gomez')).exactos.length, 2);
});

test('buscarInternacion usa el censo: exacto sin SQL extra, aproximado con aviso', async () => {
	const ctx = ctxBase();
	const exacto = await clinica.buscarInternacion({ termino: 'sanabria' }, ctx);
	assert.equal(exacto.internaciones[0].numeroVisita, 458887);
	assert.ok(exacto.internaciones[0].link);
	assert.equal(consultasDb.length, 1, 'solo la query del censo');

	const aprox = await clinica.buscarInternacion({ termino: 'sanabira' }, ctx);
	assert.equal(aprox.aproximado, true);
	assert.match(aprox.aviso, /el más parecido es SANABRIA ELIZABETH/);
	assert.equal(consultasDb.filter((c) => /asistente:censo/.test(c.sql)).length, 1, 'el censo sale de caché');
});

test('una carga con nombre aproximado no arma tarjeta: pide confirmar el paciente', async () => {
	process.env.ASISTENTE_INTERNACION_ESCRITURA = '1';
	stubHttp(() => null);
	const ctx = ctxBase({ permisos: [...PERMISOS, 'INTERNACION.EVOLUCIONES.CREAR'] });
	const out = await ejecutar('preparar_evolucion', { termino: 'sanabira', texto: 'estable' }, ctx);
	assert.equal(out.pedir, 'cual');
	assert.match(out.aviso, /Confirmá el paciente/);
	assert.equal(ctx.pendientes.length, 0);
});

/* ───────────── intención ───────────── */

test('intención: carga, ayuda, ubicar y navegar', () => {
	const c = (texto, extra) => intencion.clasificar({ texto, ...extra });
	assert.equal(c('evolucioná a Meza: estable').escribe, true);
	assert.equal(c('cargale una evolución a Sanabria').escribe, true);
	assert.equal(c('egresá a Miranda').escribe, true);
	assert.equal(c('pedile una rx de tórax a Gómez').escribe, true);
	assert.equal(c('cómo cargo una evolución', { ayuda: true }).escribe, false);
	assert.equal(c('qué evoluciones tiene Sanabria').escribe, false);
	assert.equal(c('ver las indicaciones de hoy').escribe, false);
	assert.equal(c('alta medica', { cargaEnCurso: true }).escribe, true, 'contesta el motivo de un egreso en curso');

	assert.equal(c('dónde está Sanabria').soloUbicar, true);
	assert.equal(c('dónde está Sanabria y qué estudios tiene').soloUbicar, false);
	assert.equal(c('en qué cama está Meza?').soloUbicar, true);
	assert.equal(c('llevame a turnos').soloNavegar, true);
	assert.equal(c('llevame a turnos y decime cómo saco uno').soloNavegar, false);
	assert.equal(c('evolucioná a Meza: estable').cargaSimple, true);
	assert.equal(c('evolucioná a Meza y decime los signos').cargaSimple, false);
});

test('intención: solo las tools de carga del tipo pedido (lo dictado no cuenta)', () => {
	const c = (texto, extra) => intencion.clasificar({ texto, ...extra }).cargas;
	assert.deepEqual(c('evolucioná a Meza: pedí rx y hemograma'), ['preparar_evolucion', 'editar_evolucion', 'eliminar_evolucion']);
	assert.deepEqual(c('pedile una rx de tórax a Gómez'), ['solicitar_estudios']);
	assert.deepEqual(c('hacele la epicrisis a Sanabria'), ['preparar_epicrisis']);
	assert.equal(c('ponele que está estable'), null, 'sin tipo reconocible van todas');
	assert.equal(c('alta medica', { cargaEnCurso: true }), null, 'con una carga en curso van todas');
	assert.equal(c('qué evoluciones tiene Meza'), null, 'consulta: no escribe');
});

/* ───────────── loop ───────────── */

test('loop: respuestaDirecta corta sin segunda llamada al modelo y no duplica el texto', async () => {
	let llamadas = 0;
	const chat = async () => {
		llamadas++;
		return { content: null, toolCalls: [{ id: 'c1', function: { name: 'pase', arguments: '{}' } }] };
	};
	const messages = [{ role: 'user', content: 'pase de UTI' }];
	const out = await agenteLoop({
		messages,
		tools: [],
		chat,
		ejecutar: async () => ({ total: 2, respuestaDirecta: '### Pase UTI' }),
	});
	assert.equal(llamadas, 1);
	assert.equal(out.texto, '### Pase UTI');
	assert.equal(out.finishReason, 'directa');
	const tool = messages.find((m) => m.role === 'tool');
	assert.doesNotMatch(tool.content, /Pase UTI/);
	assert.equal(messages.at(-1).role, 'assistant');
});

test('loop: si una tool de la iteración no trae respuestaDirecta, el modelo redacta; tools se releen', async () => {
	const vistas = [];
	let n = 0;
	const chat = async ({ tools }) => {
		vistas.push(tools.map((t) => t.function.name));
		n++;
		if (n === 1) {
			return {
				content: null,
				toolCalls: [
					{ id: 'a', function: { name: 'directa', arguments: '{}' } },
					{ id: 'b', function: { name: 'normal', arguments: '{}' } },
				],
			};
		}
		return { content: 'redactado', toolCalls: [] };
	};
	let habilitadas = false;
	const out = await agenteLoop({
		messages: [],
		tools: () => (habilitadas ? [{ function: { name: 'x' } }, { function: { name: 'y' } }] : [{ function: { name: 'x' } }]),
		chat,
		ejecutar: async (nombre) => {
			habilitadas = true;
			return nombre === 'directa' ? { respuestaDirecta: 'listo' } : { ok: true };
		},
	});
	assert.equal(out.texto, 'redactado');
	assert.deepEqual(vistas, [['x'], ['x', 'y']]);
});

/* ───────────── respuestas directas ───────────── */

test('directas: tarjeta de una carga simple, ficha al ubicar y navegar', () => {
	const tarjeta = { requiereConfirmacion: true, idPendiente: 'p1', resumen: 'Cargar evolución a MEZA FRANCO MATIAS' };
	const ctxCarga = { intencion: intencion.clasificar({ texto: 'evolucioná a Meza: estable' }), mensaje: 'evolucioná a Meza: estable' };
	assert.match(directas.aplicar('preparar_evolucion', tarjeta, ctxCarga).respuestaDirecta, /tarjeta: \*\*Cargar evolución a MEZA/);

	const med = 'indicale paracetamol 1 g y control de signos a Meza';
	const conMed = directas.aplicar('preparar_indicacion', tarjeta, { intencion: intencion.clasificar({ texto: med }), mensaje: med });
	assert.equal(conMed.respuestaDirecta, undefined, 'con medicación el modelo tiene que explicar');

	const ubicar = { intencion: intencion.clasificar({ texto: 'dónde está Sanabria' }) };
	const r = directas.aplicar('buscar_internado', { total: 1, internaciones: [CENSO[0]] }, ubicar);
	assert.match(r.respuestaDirecta, /\*\*SANABRIA ELIZABETH\*\*/);
	assert.match(r.respuestaDirecta, /Cama: 105/);
	assert.doesNotMatch(r.respuestaDirecta, /Tipo:/);
	const varios = directas.aplicar('buscar_internado', { total: 2, internaciones: CENSO.slice(2) }, ubicar);
	assert.equal(varios.respuestaDirecta, undefined, 'con varios el modelo pregunta cuál');

	const nav = directas.aplicar('navegar', { ok: true, motivo: 'Turnos' }, { intencion: intencion.clasificar({ texto: 'llevame a turnos' }) });
	assert.match(nav.respuestaDirecta, /\*\*Turnos\*\*/);
	assert.equal(directas.aplicar('ver_evoluciones', { items: [] }, ubicar).respuestaDirecta, undefined);
});

/* ───────────── lecturas compuestas ───────────── */

test('pase_de_guardia: por cama, día de internación, última evolución y estudios pendientes', async () => {
	stubHttp((req) => {
		if (req.path === '/api/evoluciones/458901/byDate') {
			return { status: 200, body: { data: [{ FechaEv: '2026-10-12', HoraEv: '08:00', ProfesionalNombreCompleto: 'DRA. PAZ', Evolucion: 'Estable, sin fiebre.' }] } };
		}
		if (req.path === '/api/solicitudes-estudios/visita/458902') {
			return { status: 200, body: { data: [{ Items: [{ PracticaSolicitada: 'RX TORAX', Cumplido: 0 }, { PracticaSolicitada: 'HEMOGRAMA', Cumplido: 1 }] }] } };
		}
		return null;
	});
	const out = await guardia.paseDeGuardia({ sector: 'terapia intensiva' }, ctxBase());
	assert.equal(out.total, 2);
	const t = out.respuestaDirecta;
	assert.match(t, /Pase de guardia · TERAPIA INTENSIVA \(UTI\) · 2 internados/);
	assert.ok(t.indexOf('Cama 3 · GOMEZ ANA') < t.indexOf('Cama 4 · GOMEZ ANALIA'));
	assert.match(t, /Última evolución \(2026-10-12 08:00, DRA\. PAZ\): Estable, sin fiebre\./);
	assert.match(t, /Sin evoluciones en las últimas 48 h/);
	assert.match(t, /Estudios pendientes: RX TORAX\n|Estudios pendientes: RX TORAX$/m);
	assert.doesNotMatch(t, /HEMOGRAMA/);
	assert.match(t, /día \d+ · Dx:/);
	assert.equal(llamadasHttp.length, 4, 'dos lecturas por paciente');
});

test('pase_de_guardia: sin permiso de evoluciones no las lee; sin sector ofrece la lista', async () => {
	stubHttp(() => null);
	const out = await guardia.paseDeGuardia({ sector: 'QUR2' }, ctxBase({ permisos: ['INTERNACION.CAMAS.VER'] }));
	assert.equal(llamadasHttp.length, 0);
	assert.doesNotMatch(out.respuestaDirecta, /Última evolución/);
	assert.match(out.respuestaDirecta, /Sin permiso para ver evoluciones o estudios/);

	const sin = await guardia.paseDeGuardia({}, ctxBase());
	assert.match(sin.respuestaDirecta, /¿de qué sector\?/);
	assert.match(sin.respuestaDirecta, /QUIRURGICO 2 \(QUR2\): 2/);

	const mal = await guardia.paseDeGuardia({ sector: 'pediatria' }, ctxBase());
	assert.match(mal.error, /No encontré internados en el sector «pediatria»/);
	assert.match(mal.respuestaDirecta, /TERAPIA INTENSIVA/);
});

test('listar_internados: conteo por sector y tabla por cama, sin llamadas HTTP', async () => {
	stubHttp(() => null);
	const todos = await guardia.listarInternados({}, ctxBase());
	assert.match(todos.respuestaDirecta, /4 internados/);
	const qur = await guardia.listarInternados({ sector: 'qur2' }, ctxBase());
	assert.match(qur.respuestaDirecta, /\| 102 \| MEZA FRANCO MATIAS \| 458900 \|/);
	assert.ok(qur.respuestaDirecta.indexOf('| 102 |') < qur.respuestaDirecta.indexOf('| 105 |'));
	assert.equal(llamadasHttp.length, 0);
});

test('resumen_internacion: todo en una llamada, con foco y sin links internos repetidos', async () => {
	stubHttp((req) => {
		if (req.path === '/api/evoluciones/458887/byDate') {
			return { status: 200, body: { data: [{ IdHCEvolucion: 1, FechaEv: '2026-10-12', HoraEv: '09:00', Evolucion: 'Afebril.' }] } };
		}
		if (req.path === '/api/indicaciones/458887/byDate') {
			return { status: 200, body: { data: [{ descripcion: 'Control de signos vitales', frecuencia: 'c/6 h', tipo: 'C' }] } };
		}
		if (req.path === '/api/solicitudes-estudios/visita/458887') {
			return { status: 200, body: { data: [{ Items: [{ PracticaSolicitada: 'TAC', Cumplido: 0 }] }] } };
		}
		return null;
	});
	const ctx = ctxBase();
	const out = await guardia.resumenInternacion({ termino: 'sanabria' }, ctx);
	assert.match(out.ficha, /SANABRIA ELIZABETH/);
	assert.equal(ctx.foco.numeroVisita, 458887);
	assert.ok(out.diasInternado >= 0);
	assert.equal(out.evoluciones.items?.length ?? out.evoluciones.registros?.length ?? 1, 1);
	assert.deepEqual(out.indicaciones.items, ['Control de signos vitales · c/6 h']);
	assert.deepEqual(out.estudios.pendientes.map((e) => e.practica), ['TAC']);
	assert.ok(Array.isArray(out.historiaClinica) && out.historiaClinica.length === 4);
	assert.equal(out.evoluciones.link, undefined);
	assert.ok(JSON.stringify(out).length < 9000, 'entra sin el recorte genérico');
});

test('resumen_internacion: una parte sin permiso se informa, no se lee', async () => {
	stubHttp(() => null);
	const ctx = ctxBase({ permisos: ['INTERNACION.EVOLUCIONES.VER'] });
	const out = await guardia.resumenInternacion({ numeroVisita: 458887 }, ctx);
	assert.match(out.indicaciones.error, /Sin permiso \(INTERNACION\.INDICACIONES\.VER\)/);
	assert.match(out.estudios.error, /Sin permiso/);
	assert.ok(!llamadasHttp.some((r) => /indicaciones|solicitudes-estudios/.test(r.path)));
	assert.match(out.ficha, /SANABRIA/, 'la ficha sale del censo aunque venga solo la visita');
});

/* ───────────── prompt ───────────── */

test('resumenPermisos: una línea por módulo y «todas» si tiene la matriz completa del submódulo', () => {
	const r = contexto.resumenPermisos(require(src('utils/permisos')).permisosDeRol('ADMIN'));
	const lineas = r.split('\n');
	assert.equal(new Set(lineas.map((l) => l.split(':')[0])).size, lineas.length);
	assert.match(r, /todas/);
	assert.equal(contexto.resumenPermisos(['INTERNACION.CAMAS.VER', 'INTERNACION.EVOLUCIONES.VER']), 'INTERNACION: CAMAS VER · EVOLUCIONES VER');
});
