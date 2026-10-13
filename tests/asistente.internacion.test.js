/**
 * Agente INTERNACION: cada tool contra SQL y HTTP simulados. No toca ninguna base.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// Las tools de escritura se prueban con la escritura habilitada; el modo solo lectura tiene su test.
process.env.ASISTENTE_INTERNACION_ESCRITURA = '1';

let filasDb = [];
const dbPath = require.resolve(src('models/db.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		executeQuery: async (sql, params = []) => (typeof filasDb === 'function' ? filasDb(sql, params) : filasDb),
		getRequestPool: async () => ({}),
		sql: {},
	},
};

const httpInterno = require(src('asistente/httpInterno'));
const { ejecutar } = require(src('asistente/ejecutar'));
const pendientes = require(src('asistente/pendientes'));
const catalogo = require(src('asistente/catalogo'));
const internacion = require(src('asistente/agentes/internacion'));
const permisosService = require(src('services/permisos.service'));

const autoria = require(src('asistente/autoria'));
const orquestador = require(src('asistente/agentes/orquestador'));
const hc = require(src('asistente/historiaClinica'));

const PERMISOS = [
	'INTERNACION.CAMAS.VER',
	'INTERNACION.ESTUDIOS.VER',
	'INTERNACION.EVOLUCIONES.VER',
	'INTERNACION.EVOLUCIONES.CREAR',
	'INTERNACION.EVOLUCIONES.EDITAR',
	'INTERNACION.EVOLUCIONES.ELIMINAR',
	'INTERNACION.INDICACIONES.VER',
	'INTERNACION.MOVIMIENTOS.VER',
	'INTERNACION.MOVIMIENTOS.TRASLADAR',
	'INTERNACION.MOVIMIENTOS.GESTIONAR',
];

const SANABRIA = {
	numeroVisita: 458887,
	idPaciente: 9001,
	paciente: 'SANABRIA ELIZABETH',
	documento: '35001268',
	hc: 1234,
	ingreso: '01/10/2026',
	egresada: 0,
	diagnostico: 'NEUMONIA',
	sector: 'QUR2',
	sectorDescripcion: 'QUIRURGICO 2',
	cama: '04',
};

const GOMEZ = { ...SANABRIA, numeroVisita: 479635, idPaciente: 9002, paciente: 'GOMEZ FRANCISCO', documento: '16296312', cama: '01' };

let llamadas = [];
let rutas = {};
const llamarOriginal = httpInterno.llamar;

function stubHttp(mapa) {
	llamadas = [];
	rutas = mapa;
	httpInterno.llamar = async (req) => {
		llamadas.push(req);
		const key = `${req.method} ${req.path}`;
		const r = rutas[key];
		if (!r) return { status: 404, body: { mensaje: `sin stub ${key}` } };
		return typeof r === 'function' ? r(req) : r;
	};
}

const verificarOriginal = autoria.verificar;

test.afterEach(() => {
	httpInterno.llamar = llamarOriginal;
	autoria.verificar = verificarOriginal;
	filasDb = [];
});

function ctxBase(extra) {
	return {
		permisos: PERMISOS,
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: 1,
		valorPersonal: 10,
		token: 't',
		req: { headers: {}, matricula: 4521 },
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

function focoSanabria() {
	return { tipo: 'internacion', paciente: SANABRIA.paciente, numeroVisita: SANABRIA.numeroVisita };
}

test('el agente expone el CRUD completo y todas las tools tienen implementación', () => {
	const names = catalogo
		.seleccionar({ permisos: PERMISOS, agente: 'INTERNACION', tienePermiso: permisosService.tienePermiso })
		.map((h) => h.name);
	assert.deepEqual(
		names.sort(),
		[
			'asignar_cama',
			'buscar_internado',
			'editar_evolucion',
			'eliminar_evolucion',
			'listar_camas_libres',
			'navegar',
			'preparar_egreso',
			'preparar_evolucion',
			'revertir_egreso',
			'trasladar_cama',
			'ver_estudios',
			'ver_evoluciones',
			'ver_historia_clinica',
			'ver_indicaciones',
			'ver_movimientos',
		].sort(),
	);
	for (const h of internacion.HERRAMIENTAS.filter((x) => x.mutante)) {
		assert.equal(typeof h.preparar, 'function', `${h.name} escribe sin tarjeta Confirmar`);
	}
	for (const h of internacion.HERRAMIENTAS) {
		assert.ok(
			typeof h.run === 'function' || typeof h.preparar === 'function' || h.plataforma,
			`${h.name} sin implementación`,
		);
	}
	assert.ok(!names.includes('llamar_api'));
});

const LECTURAS = [
	'buscar_internado',
	'listar_camas_libres',
	'navegar',
	'ver_estudios',
	'ver_evoluciones',
	'ver_historia_clinica',
	'ver_indicaciones',
	'ver_movimientos',
];
const ALTAS = [
	'preparar_evolucion',
	'preparar_hc_ingreso',
	'preparar_indicacion',
	'solicitar_estudios',
	'solicitar_interconsulta',
	'preparar_protocolo',
	'preparar_epicrisis',
];
const PERMISOS_CREAR = [
	...PERMISOS,
	'INTERNACION.HISTORIA_CLINICA.CREAR',
	'INTERNACION.INDICACIONES.CREAR',
	'INTERNACION.ESTUDIOS.CREAR',
	'INTERNACION.INTERCONSULTAS.CREAR',
	'INTERNACION.PROTOCOLOS.CREAR',
	'INTERNACION.EPICRISIS.CREAR',
];

function conModo(valor, fn) {
	const antes = process.env.ASISTENTE_INTERNACION_ESCRITURA;
	if (valor === undefined) delete process.env.ASISTENTE_INTERNACION_ESCRITURA;
	else process.env.ASISTENTE_INTERNACION_ESCRITURA = valor;
	try {
		return fn();
	} finally {
		process.env.ASISTENTE_INTERNACION_ESCRITURA = antes;
	}
}

function ofrecidas(permisos = PERMISOS_CREAR) {
	return catalogo.seleccionar({ permisos, agente: 'INTERNACION', tienePermiso: permisosService.tienePermiso }).map((h) => h.name);
}

test('modo por defecto: lectura + altas del menú médico, sin egreso/traslado/editar/borrar', () => {
	conModo(undefined, () => {
		assert.deepEqual(ofrecidas().sort(), [...LECTURAS, ...ALTAS].sort());
		const prompt = internacion.instrucciones();
		assert.match(prompt, /todavía NO se egresa/);
		assert.match(prompt, /MEDICACIÓN no se indica/);
		assert.doesNotMatch(prompt, /preparar_egreso|trasladar_cama|editar_evolucion/);
	});
});

test('modo lectura (=0): no se ofrece ninguna escritura y el prompt lo dice', () => {
	conModo('0', () => {
		assert.deepEqual(ofrecidas().sort(), [...LECTURAS].sort());
		const prompt = internacion.instrucciones();
		assert.match(prompt, /SOLO se consulta/);
		assert.doesNotMatch(prompt, /preparar_egreso|trasladar_cama|preparar_evolucion/);
	});
});

test('una escritura no habilitada se rechaza aunque el modelo la llame', async () => {
	pendientes.resetStore();
	stubHttp({});
	const out = await conModo(undefined, () => ejecutar('trasladar_cama', { cama: '105' }, ctxBase({ foco: focoSanabria() })));
	assert.match(out.error, /todavía no está habilitado/);
	assert.equal(llamadas.length, 0);
});

test('sin permisos de escritura no se ofrece preparar_egreso', () => {
	const names = catalogo
		.seleccionar({
			permisos: ['INTERNACION.CAMAS.VER'],
			agente: 'INTERNACION',
			tienePermiso: permisosService.tienePermiso,
		})
		.map((h) => h.name);
	assert.ok(names.includes('buscar_internado'));
	assert.ok(names.includes('listar_camas_libres'));
	for (const n of ['preparar_egreso', 'trasladar_cama', 'asignar_cama', 'revertir_egreso', 'editar_evolucion', 'eliminar_evolucion']) {
		assert.ok(!names.includes(n), `${n} ofrecida sin permiso`);
	}
});

test('buscar_internado: un resultado deja la ficha en foco (ctx y sesión)', async () => {
	filasDb = [SANABRIA];
	const ctx = ctxBase();
	const out = await ejecutar('buscar_internado', { termino: 'Sanabria Elizabeth' }, ctx);
	assert.equal(out.total, 1);
	assert.equal(out.internaciones[0].numeroVisita, 458887);
	assert.match(out.ficha, /458887/);
	assert.match(out.ficha, /35001268/);
	assert.equal(ctx.foco.numeroVisita, 458887);
	assert.equal(ctx.conv.foco.numeroVisita, 458887);
	assert.ok(ctx.navegaciones.some((n) => n.href.startsWith('/dashboard/visita/458887')));
});

test('buscar_internado: varios resultados no fijan foco y piden cuál', async () => {
	filasDb = [SANABRIA, { ...SANABRIA, numeroVisita: 458900, paciente: 'SANABRIA ELIZABETH MARIA' }];
	const ctx = ctxBase();
	const out = await ejecutar('buscar_internado', { termino: 'Sanabria' }, ctx);
	assert.equal(out.total, 2);
	assert.match(out.aviso, /cuál/);
	assert.equal(ctx.foco, null);
});

test('ver_estudios hechos: usa la visita en foco y nunca la bandeja /pendientes', async () => {
	stubHttp({
		'GET /api/solicitudes-estudios/visita/458887': {
			status: 200,
			body: {
				success: true,
				data: [
					{
						SectorReceptorNombre: 'ECOGRAFIA',
						MedicoSolicitanteNombre: 'DR X',
						Items: [
							{ PracticaSolicitada: 'ECODOPPLER VENOSO', Cumplido: true, FechaResultado: '2026-10-05', TextoResultado: 'Sin trombosis.' },
							{ PracticaSolicitada: 'ECO ABDOMINAL', Cumplido: false },
						],
					},
					{
						SectorReceptorNombre: 'TOMOGRAFIA',
						Items: [{ PracticaSolicitada: 'TAC TORAX', Cumplido: true, TextoResultado: 'Consolidación basal derecha.' }],
					},
				],
			},
		},
	});
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('ver_estudios', { filtro: 'hechos' }, ctx);
	assert.equal(llamadas.length, 1);
	assert.equal(llamadas[0].path, '/api/solicitudes-estudios/visita/458887');
	assert.ok(!llamadas.some((l) => /pendientes/.test(l.path)));
	assert.equal(out.total, 2);
	assert.equal(out.hechos, 2);
	assert.equal(out.pendientes, 1);
	assert.deepEqual(out.estudios.map((e) => e.practica).sort(), ['ECODOPPLER VENOSO', 'TAC TORAX']);
	assert.ok(out.estudios.every((e) => e.hecho));
	assert.ok(ctx.navegaciones.some((n) => n.href === '/dashboard/visita/458887?seccion=solicitudEstudios'));
});

test('ver_estudios sin visita ni foco no llama a la API', async () => {
	stubHttp({});
	const out = await ejecutar('ver_estudios', { filtro: 'hechos' }, ctxBase());
	assert.match(out.error, /buscar_internado/);
	assert.equal(llamadas.length, 0);
});

test('ver_evoluciones todas pide days=all de la visita en foco', async () => {
	stubHttp({ 'GET /api/evoluciones/458887/byDate': { status: 200, body: { success: true, data: [{ Evolucion: 'Estable' }] } } });
	const out = await ejecutar('ver_evoluciones', { todas: true }, ctxBase({ foco: focoSanabria() }));
	assert.equal(llamadas[0].query.days, 'all');
	assert.equal(out.total, 1);
});

test('ver_indicaciones lee la visita pedida aunque haya otra en foco', async () => {
	stubHttp({
		'GET /api/indicaciones/479635/byDate': {
			status: 200,
			body: { success: true, data: [{ descripcion: 'DIETA HIPOSODICA', frecuencia: 'DIARIA     ', id: 'x' }] },
		},
	});
	const out = await ejecutar('ver_indicaciones', { numeroVisita: 479635 }, ctxBase({ foco: focoSanabria() }));
	assert.equal(llamadas[0].path, '/api/indicaciones/479635/byDate');
	assert.match(llamadas[0].query.date, /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(out.total, 1);
	assert.deepEqual(out.indicaciones[0], { descripcion: 'DIETA HIPOSODICA', frecuencia: 'DIARIA' });
});

test('ver_indicaciones sin carga ese día trae las últimas y lo avisa', async () => {
	stubHttp({
		'GET /api/indicaciones/458887/byDate': { status: 200, body: { success: true, data: [] } },
		'GET /api/indicaciones/ultimas/458887': {
			status: 200,
			body: {
				success: true,
				data: [
					{ tipo: 'C', descripcion: 'CONTROL SIGNOS', medicamento: 'ACETATO DE BUTILO 1 LT', vigenteDesde: '2025-12-09' },
					{ tipo: 'M', descripcion: 'SOL FISIOLOGICA', medicamento: 'SOL FISIOLOGICA 500' },
				],
			},
		},
	});
	const out = await ejecutar('ver_indicaciones', { fecha: '2026-10-12' }, ctxBase({ foco: focoSanabria() }));
	assert.equal(out.total, 0);
	assert.match(out.aviso, /No hay indicaciones cargadas el 2026-10-12/);
	assert.match(out.aviso, /2025-12-09/);
	assert.equal(out.ultimas[0].descripcion, 'CONTROL SIGNOS');
	assert.equal(out.ultimas[0].medicamento, undefined);
	assert.equal(out.ultimas[1].medicamento, 'SOL FISIOLOGICA 500');
});

function contextoClinico(paciente, extra = {}) {
	return {
		status: 200,
		body: {
			data: {
				NombrePaciente: paciente,
				documentoPaciente: '1',
				sector: 'CM1',
				numeroCama: '02',
				egresada: false,
				DiagnosticoDescripcion: 'NEUMONIA',
				...extra,
			},
		},
	};
}

function stubEgreso(nv, paciente, extra = {}) {
	stubHttp({
		[`GET /api/patients/visitas/${nv}/contexto-clinico`]: contextoClinico(paciente),
		...extra,
		'GET /api/disposiciones-egreso': {
			status: 200,
			body: [
				{ Valor: 1, Descripcion: 'ALTA MEDICA' },
				{ Valor: 2, Descripcion: 'DERIVACION' },
			],
		},
	});
}

test('preparar_egreso con motivo deja tarjeta Confirmar y no egresa', async () => {
	pendientes.resetStore();
	stubEgreso(458887, SANABRIA.paciente);
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('preparar_egreso', { disposicion: 'alta medica' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /458887/);
	assert.match(out.resumen, /ALTA MEDICA/);
	assert.equal(ctx.pendientes.length, 1);
	assert.ok(llamadas.every((l) => l.method === 'GET'), 'no se ejecutó ningún POST');
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.path, '/api/patients/visitas/egreso');
	assert.equal(item.http.body.disposicionEgreso, 1);
	pendientes.cancelar(out.idPendiente, 1, 10);
	assert.equal(pendientes.peek(out.idPendiente, 1, 10), null);
});

test('preparar_egreso sin motivo pide el motivo con las opciones del catálogo', async () => {
	pendientes.resetStore();
	stubEgreso(458887, SANABRIA.paciente);
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('preparar_egreso', {}, ctx);
	assert.equal(out.pedir, 'motivo');
	assert.equal(out.opciones.length, 2);
	assert.equal(ctx.pendientes.length, 0);
});

test('preparar_egreso toma el motivo del mensaje si el modelo no lo pasó', async () => {
	pendientes.resetStore();
	stubEgreso(458887, SANABRIA.paciente);
	const ctx = ctxBase({
		foco: focoSanabria(),
		req: { headers: {}, matricula: 4521, body: { mensaje: 'egresar a Sanabria por Alta Médica' } },
	});
	const out = await ejecutar('preparar_egreso', {}, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /ALTA MEDICA/);
	pendientes.cancelar(out.idPendiente, 1, 10);
});

const MIRANDA = { ...SANABRIA, numeroVisita: 404444, idPaciente: 9003, paciente: 'MIRANDA CELESTE STEFANIA', cama: '02' };
const UMBERT = { ...SANABRIA, numeroVisita: 410001, idPaciente: 9004, paciente: 'UMBERT BRIJIDA', cama: '05' };

function dbPorNombre(...filas) {
	return (sql, params) => {
		const likes = params.map((p) => String(p.value || '').replace(/%/g, '').toLowerCase()).filter(Boolean);
		return filas.filter((f) => likes.every((l) => f.paciente.toLowerCase().includes(l) || String(f.numeroVisita) === l));
	};
}

test('egreso: nombre + visita de OTRO paciente (pantalla) → error, nunca tarjeta', async () => {
	pendientes.resetStore();
	filasDb = dbPorNombre(MIRANDA, UMBERT);
	stubEgreso(404444, MIRANDA.paciente);
	const ctx = ctxBase({ entidades: { numeroVisita: '404444' } });
	const out = await ejecutar('preparar_egreso', { termino: 'umbert', numeroVisita: 404444, disposicion: 'alta medica' }, ctx);
	assert.match(out.error, /404444 no es de «umbert»/);
	assert.equal(ctx.pendientes.length, 0);
	assert.ok(!llamadas.some((l) => l.path.includes('/404444/contexto-clinico')));
});

test('egreso: «egresemos a umbert» con Miranda en pantalla y después «alta medica» → Umbert', async () => {
	pendientes.resetStore();
	filasDb = dbPorNombre(MIRANDA, UMBERT);
	stubEgreso(410001, UMBERT.paciente, {
		'GET /api/patients/visitas/404444/contexto-clinico': contextoClinico(MIRANDA.paciente),
	});
	const conv = {};
	const pantalla = { internado: { numeroVisita: 404444, paciente: MIRANDA.paciente } };
	const ctx1 = ctxBase({ conv, pantalla, entidades: { numeroVisita: '404444' } });
	const t1 = await ejecutar('preparar_egreso', { termino: 'umbert' }, ctx1);
	assert.equal(t1.pedir, 'motivo');
	assert.equal(t1.internacion.paciente, 'UMBERT BRIJIDA');
	assert.equal(t1.internacion.numeroVisita, 410001);
	assert.match(t1.diagnosticoEgreso, /se mantiene el de la internación \(NEUMONIA\)/);
	assert.equal(conv.foco.numeroVisita, 410001);

	const ctx2 = ctxBase({
		conv,
		foco: conv.foco,
		pantalla,
		entidades: { numeroVisita: '404444' },
		req: { headers: {}, matricula: 4521, body: { mensaje: 'alta medica' } },
	});
	const t2 = await ejecutar('preparar_egreso', {}, ctx2);
	assert.equal(t2.requiereConfirmacion, true);
	assert.match(t2.resumen, /UMBERT BRIJIDA \(visita 410001/);
	assert.ok(!/MIRANDA|404444/.test(t2.resumen));
	assert.match(t2.resumen, /Dx egreso: se mantiene el de la internación \(NEUMONIA\)/);
	assert.equal(pendientes.peek(t2.idPendiente, 1, 10).http.body.numeroVisita, 410001);
	pendientes.cancelar(t2.idPendiente, 1, 10);
});

test('egreso: diagnóstico en texto libre se rechaza; código CIE pasa', async () => {
	pendientes.resetStore();
	stubEgreso(458887, SANABRIA.paciente);
	const ctx = ctxBase({ foco: focoSanabria() });
	const mal = await ejecutar('preparar_egreso', { disposicion: 'alta medica', diagnosticoEgreso: 'neumonia grave' }, ctx);
	assert.match(mal.error, /no es un código CIE/);
	assert.equal(ctx.pendientes.length, 0);
	const bien = await ejecutar('preparar_egreso', { disposicion: 'alta medica', diagnosticoEgreso: 'j18.9' }, ctx);
	assert.equal(pendientes.peek(bien.idPendiente, 1, 10).http.body.diagnosticoEgreso, 'J18.9');
	assert.match(bien.resumen, /Dx egreso: J18\.9/);
	pendientes.cancelar(bien.idPendiente, 1, 10);
});

test('preparar_egreso con otro paciente nombrado no usa el foco', async () => {
	pendientes.resetStore();
	filasDb = [GOMEZ];
	stubEgreso(479635, GOMEZ.paciente);
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('preparar_egreso', { termino: 'gomez francisco', disposicion: 'derivacion' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /479635/);
	assert.ok(!/458887/.test(out.resumen));
});

/* ───────────── CRUD de internación ───────────── */

const CAMAS_LIBRES = [
	{ sector: 'UTI', sectorDescripcion: 'TERAPIA INTENSIVA', cama: '105', estado: 'DESOCUPADA' },
	{ sector: 'UTI', sectorDescripcion: 'TERAPIA INTENSIVA', cama: '106', estado: 'DESOCUPADA' },
	{ sector: 'CM1', sectorDescripcion: 'CLINICA MEDICA 1', cama: '07', estado: 'DESOCUPADA' },
];

const esSqlCamas = (sql) => /TOP 200/.test(sql) && /imHabitacionCamas/.test(sql);

/** Camas libres para la query de camas; internados por nombre para el resto. */
function dbCamasY(...internados) {
	const porNombre = dbPorNombre(...internados);
	return (sql, params) => {
		if (!esSqlCamas(sql)) return porNombre(sql, params);
		const sector = params[6]?.value;
		return sector ? CAMAS_LIBRES.filter((c) => c.sector === sector) : CAMAS_LIBRES;
	};
}

test('orquestador: traslados, movimientos y «internar» van a Internación', () => {
	for (const t of ['trasladá a sanabria a la 105', 'ver movimientos de gomez', 'hay que internar a perez', 'reubicar al de la 04']) {
		assert.equal(orquestador.clasificar({ texto: t }), 'INTERNACION', t);
	}
});

test('listar_camas_libres filtra por sector', async () => {
	let params = null;
	filasDb = (sql, p) => {
		params = p;
		return CAMAS_LIBRES.filter((c) => c.sector === 'UTI');
	};
	const out = await ejecutar('listar_camas_libres', { sector: 'UTI' }, ctxBase());
	assert.equal(out.total, 2);
	assert.deepEqual(out.camas.map((c) => c.cama), ['105', '106']);
	assert.ok(params.some((p) => p.value === 'UTI'));
	assert.ok(params.some((p) => p.value === 'O'), 'excluye camas ocupadas');
});

test('ver_movimientos resume el historial de la visita en foco', async () => {
	stubHttp({
		'GET /api/patients/visitas/458887/movimientos': {
			status: 200,
			body: {
				success: true,
				data: [
					{ NombreSector: 'GUARDIA', NombreCama: '01', FechaAdmisionISO: '2026-10-01', HoraAdmisionISO: '08:00', FechaEgresoISO: '2026-10-02', HoraEgresoISO: '10:00', OperadorNombre: 'ADMIN' },
					{ NombreSector: 'QUIRURGICO 2', NombreCama: '04', FechaAdmisionISO: '2026-10-02', HoraAdmisionISO: '10:00' },
				],
			},
		},
	});
	const out = await ejecutar('ver_movimientos', {}, ctxBase({ foco: focoSanabria() }));
	assert.equal(out.total, 2);
	assert.deepEqual(out.movimientos[0], {
		sector: 'GUARDIA',
		cama: '01',
		servicio: null,
		desde: '2026-10-01 08:00',
		hasta: '2026-10-02 10:00',
		disposicion: null,
		diagnostico: null,
		operador: 'ADMIN',
	});
	assert.equal(out.movimientos[1].hasta, null);
});

test('trasladar_cama sin cama destino devuelve las libres y no deja tarjeta', async () => {
	pendientes.resetStore();
	filasDb = dbCamasY(SANABRIA);
	stubHttp({ 'GET /api/patients/visitas/458887/contexto-clinico': contextoClinico(SANABRIA.paciente, { sector: 'QUR2', numeroCama: '04' }) });
	const ctx = ctxBase();
	const out = await ejecutar('trasladar_cama', { termino: 'sanabria' }, ctx);
	assert.equal(out.pedir, 'cama');
	assert.equal(out.camas.length, 3);
	assert.equal(ctx.pendientes.length, 0);
});

test('trasladar_cama arma el PUT mover-cama del modal (Clarion) y deja tarjeta', async () => {
	pendientes.resetStore();
	filasDb = dbCamasY(SANABRIA, GOMEZ);
	stubHttp({ 'GET /api/patients/visitas/458887/contexto-clinico': contextoClinico(SANABRIA.paciente, { sector: 'QUR2', numeroCama: '04' }) });
	const ctx = ctxBase({ foco: { tipo: 'internacion', paciente: GOMEZ.paciente, numeroVisita: GOMEZ.numeroVisita } });
	const out = await ejecutar('trasladar_cama', { termino: 'sanabria', cama: 'UTI-105', fecha: '2026-10-12', hora: '10:30' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /SANABRIA ELIZABETH \(visita 458887\) de QUR2 cama 04 → TERAPIA INTENSIVA \(UTI\) cama 105/);
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.method, 'PUT');
	assert.equal(item.http.path, '/api/patients/visitas/458887/mover-cama');
	assert.equal(item.http.body.bedId, '105');
	assert.equal(item.http.body.ValorSector, 'UTI');
	assert.equal(item.http.body.FechaAdmision, 82468);
	assert.equal(item.http.body.HoraAdmision, 3780001);
	assert.equal(item.http.body.FechaCarga, item.http.body.FechaEgreso);
	assert.equal(ctx.foco.numeroVisita, 458887, 'el foco pasa al paciente nombrado');
	assert.ok(llamadas.every((l) => l.method === 'GET'));
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('trasladar_cama a una cama ocupada o inexistente da error con las libres', async () => {
	pendientes.resetStore();
	filasDb = dbCamasY(SANABRIA);
	stubHttp({ 'GET /api/patients/visitas/458887/contexto-clinico': contextoClinico(SANABRIA.paciente, { sector: 'QUR2', numeroCama: '04' }) });
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('trasladar_cama', { cama: '999' }, ctx);
	assert.match(out.error, /«999» no está libre/);
	assert.equal(out.camas.length, 3);
	assert.equal(ctx.pendientes.length, 0);
});

test('trasladar_cama a un internado sin cama manda a asignar_cama', async () => {
	filasDb = dbCamasY();
	stubHttp({ 'GET /api/patients/visitas/458887/contexto-clinico': contextoClinico(SANABRIA.paciente, { numeroCama: null }) });
	const out = await ejecutar('trasladar_cama', { cama: '105' }, ctxBase({ foco: focoSanabria() }));
	assert.match(out.error, /asignar_cama/);
});

test('asignar_cama ubica a un internado sin cama (POST asignar-cama, clase I)', async () => {
	pendientes.resetStore();
	filasDb = dbCamasY();
	stubHttp({
		'GET /api/patients/visitas/internados-sin-cama': (req) => ({
			status: 200,
			body: {
				success: true,
				data: [
					{ numeroVisita: 500100, apellidoYNombre: 'PEREZ JUAN', numeroDocumento: '20111222', valorSector: 'GUA' },
					{ numeroVisita: 500101, apellidoYNombre: 'PEREZ ANA', numeroDocumento: '20111333', valorSector: 'GUA' },
				].filter(() => req.query.termino === 'perez'),
			},
		}),
	});
	const ctx = ctxBase();
	const out = await ejecutar('asignar_cama', { termino: 'perez juan', cama: '07' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /PEREZ JUAN \(visita 500100\) la CLINICA MEDICA 1 \(CM1\) cama 07/);
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.method, 'POST');
	assert.equal(item.http.path, '/api/patients/visitas/500100/asignar-cama');
	assert.equal(item.http.body.ClasePaciente, 'I');
	assert.equal(item.http.body.bedId, '07');
	assert.equal(item.http.body.ValorSector, 'CM1');
	assert.equal(ctx.foco.numeroVisita, 500100);
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('asignar_cama con varios sin cama que coinciden pregunta cuál', async () => {
	stubHttp({
		'GET /api/patients/visitas/internados-sin-cama': {
			status: 200,
			body: {
				success: true,
				data: [
					{ numeroVisita: 500100, apellidoYNombre: 'PEREZ JUAN' },
					{ numeroVisita: 500101, apellidoYNombre: 'PEREZ ANA' },
				],
			},
		},
	});
	const ctx = ctxBase();
	const out = await ejecutar('asignar_cama', { termino: 'perez', cama: '07' }, ctx);
	assert.equal(out.pedir, 'cual');
	assert.equal(out.internaciones.length, 2);
	assert.equal(ctx.pendientes.length, 0);
});

test('revertir_egreso: si se puede, tarjeta POST con dónde queda el paciente', async () => {
	pendientes.resetStore();
	stubHttp({
		'GET /api/patients/visitas/410001/revertir-egreso': {
			status: 200,
			body: {
				success: true,
				data: { pacienteNombre: 'UMBERT BRIJIDA', puedeRevertir: true, camaEstado: 'libre', etiquetaUbicacion: 'CM1 · cama 05', avisos: ['Se borra la disposición de egreso.'] },
			},
		},
	});
	const ctx = ctxBase();
	const out = await ejecutar('revertir_egreso', { numeroVisita: 410001 }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /Revertir el egreso de UMBERT BRIJIDA \(visita 410001\) · vuelve a CM1 · cama 05/);
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.method, 'POST');
	assert.equal(item.http.path, '/api/patients/visitas/410001/revertir-egreso');
	assert.match(item.detalle, /disposición de egreso/);
	assert.ok(llamadas.every((l) => l.method === 'GET'));
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('revertir_egreso con conflicto o sin ser admin no deja tarjeta', async () => {
	stubHttp({
		'GET /api/patients/visitas/410001/revertir-egreso': {
			status: 200,
			body: { success: true, data: { puedeRevertir: false, mensaje: 'El paciente tiene otra visita activa', conflictos: ['visita 420000'] } },
		},
		'GET /api/patients/visitas/410002/revertir-egreso': {
			status: 403,
			body: { success: false, mensaje: 'Solo un administrador puede revertir un egreso' },
		},
	});
	const ctx = ctxBase();
	const a = await ejecutar('revertir_egreso', { numeroVisita: 410001 }, ctx);
	assert.match(a.error, /otra visita activa/);
	const b = await ejecutar('revertir_egreso', { numeroVisita: 410002 }, ctx);
	assert.match(b.error, /Solo un administrador/);
	assert.equal(ctx.pendientes.length, 0);
});

const EVOLUCION_77 = {
	IdHCEvolucion: 77,
	IdVisita: 458887,
	FechaEv: '2026-10-11',
	HoraEv: '10:30',
	IdSector: 'QUR2',
	Evolucion: 'Paciente estable, afebril.',
	NumeroDocumento: '35001268',
	Profecional: 4521,
};

function stubEvolucion(ev = EVOLUCION_77) {
	stubHttp({
		[`GET /api/evoluciones/${ev.IdHCEvolucion}`]: { status: 200, body: { success: true, data: ev } },
		[`GET /api/patients/visitas/${ev.IdVisita}/contexto-clinico`]: contextoClinico(SANABRIA.paciente, { documentoPaciente: '35001268' }),
	});
}

test('editar_evolucion propia: PUT con fecha/sector originales y texto nuevo marcado como IA', async () => {
	pendientes.resetStore();
	stubEvolucion();
	let verificado = null;
	autoria.verificar = async (ep, p) => {
		verificado = p;
		return { ok: true };
	};
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('editar_evolucion', { idEvolucion: 77, texto: 'Paciente estable, afebril. Tolera dieta.' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.equal(verificado, '/api/evoluciones/77');
	assert.match(out.resumen, /Modificar la evolución del 2026-10-11 10:30 de SANABRIA ELIZABETH/);
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.method, 'PUT');
	assert.deepEqual(item.http.body, {
		FechaEv: '2026-10-11',
		HoraEv: '10:30',
		IdSector: 'QUR2',
		Evolucion: 'Paciente estable, afebril. Tolera dieta.',
		NumeroDocumento: '35001268',
	});
	assert.deepEqual(item.generativo, ['Evolucion']);
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('editar_evolucion ajena: error, no se ofrece y no hay tarjeta', async () => {
	pendientes.resetStore();
	stubEvolucion({ ...EVOLUCION_77, Profecional: 9999 });
	autoria.verificar = async () => ({ ok: false, mensaje: 'Solo el autor puede modificar este registro', codigoError: 'REGISTRO_AJENO' });
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('editar_evolucion', { idEvolucion: 77, texto: 'otro' }, ctx);
	assert.match(out.error, /Solo el autor/);
	assert.equal(out.noOfrecer, true);
	assert.equal(ctx.pendientes.length, 0);
});

test('eliminar_evolucion de otra visita que la del paciente nombrado no se toca', async () => {
	pendientes.resetStore();
	filasDb = dbPorNombre(SANABRIA, GOMEZ);
	stubEvolucion();
	autoria.verificar = async () => ({ ok: true });
	const ctx = ctxBase();
	const out = await ejecutar('eliminar_evolucion', { termino: 'gomez', idEvolucion: 77 }, ctx);
	assert.match(out.error, /visita 458887, no de la 479635/);
	assert.equal(ctx.pendientes.length, 0);
});

test('eliminar_evolucion propia: tarjeta DELETE con el texto que se borra', async () => {
	pendientes.resetStore();
	stubEvolucion();
	autoria.verificar = async () => ({ ok: true });
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('eliminar_evolucion', { idEvolucion: 77 }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.method, 'DELETE');
	assert.equal(item.http.path, '/api/evoluciones/77');
	assert.equal(item.detalle, 'Paciente estable, afebril.');
	assert.ok(llamadas.every((l) => l.method === 'GET'));
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('preparar_evolucion con nombre: tarjeta POST para ESE paciente aunque haya otro en foco', async () => {
	pendientes.resetStore();
	filasDb = dbPorNombre(MIRANDA, UMBERT);
	stubHttp({ 'GET /api/patients/visitas/404444/contexto-clinico': contextoClinico(MIRANDA.paciente) });
	const ctx = ctxBase({ foco: { tipo: 'internacion', paciente: UMBERT.paciente, numeroVisita: UMBERT.numeroVisita } });
	const out = await ejecutar('preparar_evolucion', { termino: 'miranda', texto: 'Evolución favorable.' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /MIRANDA CELESTE STEFANIA \(visita 404444/);
	const item = pendientes.peek(out.idPendiente, 1, 10);
	assert.equal(item.http.body.IdVisita, 404444);
	assert.equal(item.http.body.Profecional, undefined, 'el autor sale del JWT');
	assert.equal(ctx.foco.numeroVisita, 404444);
	pendientes.cancelar(out.idPendiente, 1, 10);
});

/* ───────────── Lectura de la HC completa ───────────── */

const PERMISOS_HC = [
	...PERMISOS,
	'INTERNACION.HISTORIA_CLINICA.VER',
	'INTERNACION.SIGNOS_VITALES.VER',
	'INTERNACION.MEDICACION.VER',
];

test('ver_historia_clinica lee cada sección de SU endpoint, en paralelo, con su período', async () => {
	stubHttp({
		'GET /api/hc-ingreso/visita/458887': {
			status: 200,
			body: { success: true, data: [{ IdHCIngreso: 5, MotivoConsulta: 'Disnea', ExamenFisico: 'Rales bibasales', OperadorCarga: 77, NombreProfesional: 'DR X' }] },
		},
		'GET /api/controles-frecuentes/458887/byDate': (req) => ({
			status: 200,
			body: { success: true, data: [{ Fecha: '2026-10-12', TA: '120/80', FC: 88, Temperatura: 37.9, query: req.query }] },
		}),
		'GET /api/laboratorios/visita/458887': {
			status: 200,
			body: { success: true, data: [{ Fecha: '2026-10-11', Hemoglobina: 9.1, UrlArchivo: 'https://x/lab.pdf', Observacion: 'https://x/lab.pdf' }] },
		},
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC });
	const out = await ejecutar('ver_historia_clinica', { secciones: ['hc_ingreso', 'signos_vitales', 'laboratorios'], fecha: '2026-10-12' }, ctx);
	assert.equal(out.numeroVisita, 458887);
	const [hcIng, signos, labs] = out.secciones;
	assert.deepEqual(hcIng.registros[0], { MotivoConsulta: 'Disnea', ExamenFisico: 'Rales bibasales', NombreProfesional: 'DR X' });
	assert.equal(signos.registros[0].TA, '120/80');
	assert.deepEqual(signos.registros[0].query, { date: '2026-10-12', days: 3 });
	assert.match(signos.periodo, /3 días hasta 2026-10-12/);
	assert.deepEqual(labs.registros[0], { Fecha: '2026-10-11', Hemoglobina: 9.1 }, 'sin URLs ni ids');
	assert.equal(out.link, undefined, 'el link va como botón, no al modelo');
	assert.ok(ctx.navegaciones.some((n) => n.href === '/dashboard/visita/458887?seccion=hcIngreso'));
});

test('ver_historia_clinica: sección sin permiso o vacía lo dice, sin tirar las demás', async () => {
	stubHttp({
		'GET /api/medicacion-control/458887/byDate': { status: 200, body: { success: true, data: [] } },
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: [...PERMISOS, 'INTERNACION.MEDICACION.VER'] });
	const out = await ejecutar('ver_historia_clinica', { secciones: ['medicacion', 'epicrisis'], todas: true }, ctx);
	const [med, epi] = out.secciones;
	assert.equal(med.total, 0);
	assert.match(med.aviso, /Sin registros de medicación suministrada \(toda la internación\)/);
	assert.deepEqual(llamadas[0].query, { date: llamadas[0].query.date, days: 'all' });
	assert.match(epi.error, /Sin permiso \(INTERNACION\.EPICRISIS\.VER\)/);
	assert.equal(llamadas.length, 1, 'no se llama a la sección sin permiso');
});

test('ver_historia_clinica: HC larga se acorta para entrar, nunca se corta el JSON', async () => {
	stubHttp({
		'GET /api/hc-ingreso/visita/458887': {
			status: 200,
			body: { success: true, data: [{ Antecedentes: 'a '.repeat(3000), EnfermedadActual: 'b '.repeat(3000), Examen: 'c '.repeat(3000), Plan: 'd '.repeat(3000), Otro: 'e '.repeat(3000), Mas: 'f '.repeat(3000) }] },
		},
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC });
	const out = await ejecutar('ver_historia_clinica', { secciones: ['hc_ingreso'] }, ctx);
	assert.equal(out.truncado, undefined, 'no pasó por el recorte genérico');
	assert.equal(out.secciones[0].registros.length, 1);
	assert.equal(out.resumido, true);
	assert.ok(JSON.stringify(out).length <= hc.TOPE_TOTAL + 300);
	assert.equal(ctx.resumido, true, 'el turno lleva el aviso de resumen');
});

test('ver_historia_clinica: lo que entra va completo, sin resumen ni aviso', async () => {
	stubHttp({
		'GET /api/hc-ingreso/visita/458887': { status: 200, body: { success: true, data: [{ MotivoConsulta: 'Disnea' }] } },
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC });
	const out = await ejecutar('ver_historia_clinica', { secciones: ['hc_ingreso'] }, ctx);
	assert.equal(out.resumido, undefined);
	assert.equal(out.secciones[0].resumen, undefined);
	assert.equal(ctx.resumido, undefined);
});

test('ver_historia_clinica: medicación y signos se resumen sobre TODOS los registros', async () => {
	const meds = [];
	for (let d = 1; d <= 28; d++) {
		const fecha = `2026-02-${String(d).padStart(2, '0')}`;
		meds.push({ NombreMedicamento: 'OMEPRAZOL 20', FechaControl: fecha, HoraControl: '08:00', Cantidad: 1, ProfesionalApellido: 'PEREZ' });
		meds.push({ NombreMedicamento: 'CEFTRIAXONA 1G', FechaControl: fecha, HoraControl: '10:00', Cantidad: 2, ProfesionalApellido: 'PEREZ' });
	}
	meds.push({ NombreMedicamento: 'DIPIRONA', FechaControl: '2026-01-15', HoraControl: '22:00', Cantidad: 1 });
	const signos = Array.from({ length: 90 }, (_, i) => ({
		Valor: 800000 + i,
		FechaControl: `2026-02-${String(1 + (i % 28)).padStart(2, '0')}`,
		HoraControl: `${String(i % 24).padStart(2, '0')}:00`,
		Pulso: i === 0 ? 0 : 70 + (i % 30),
		Axilar: 36 + (i % 3) * 0.5,
		Observaciones: i % 10 === 0 ? `nota ${i}` : '',
	}));
	stubHttp({
		'GET /api/medicacion-control/458887/byDate': { status: 200, body: { success: true, data: meds } },
		'GET /api/controles-frecuentes/458887/byDate': { status: 200, body: { success: true, data: signos } },
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC });
	const out = await ejecutar('ver_historia_clinica', { secciones: ['medicacion', 'signos_vitales'], todas: true }, ctx);
	assert.ok(JSON.stringify(out).length <= hc.TOPE_TOTAL + 300);

	const med = out.secciones[0];
	assert.equal(med.resumido, true);
	assert.equal(med.total, 57);
	assert.equal(med.hasta, '2026-02-28 10:00');
	assert.equal(med.desde, '2026-01-15 22:00');
	assert.equal(med.resumen.totalItems, 3);
	assert.deepEqual(med.resumen.items[0], { nombre: 'CEFTRIAXONA 1G', veces: 28, cantidad: 56, ultima: '2026-02-28 10:00' });
	assert.deepEqual(med.resumen.items[1], { nombre: 'OMEPRAZOL 20', veces: 28, cantidad: 28, ultima: '2026-02-28 08:00' });
	assert.equal(med.registros[0].NombreMedicamento, 'CEFTRIAXONA 1G');

	const sv = out.secciones[1];
	assert.equal(sv.resumido, true);
	assert.equal(sv.resumen.valores.Valor, undefined, 'el id del control no es un signo');
	assert.equal(sv.resumen.valores['Pulso (lpm)'].n, 89, 'el 0 (no medido) no cuenta');
	assert.equal(sv.resumen.valores['Pulso (lpm)'].min, 70);
	assert.equal(sv.resumen.valores['Pulso (lpm)'].max, 99);
	assert.ok(sv.resumen.notas.length >= 1);
	assert.equal(ctx.resumido, true);
});

test('ver_historia_clinica sin secciones válidas no llama a nada', async () => {
	stubHttp({});
	const out = await ejecutar('ver_historia_clinica', { secciones: ['radiografias'] }, ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC }));
	assert.match(out.error, /hc_ingreso/);
	assert.equal(llamadas.length, 0);
});

test('ver_historia_clinica: lo más reciente primero y siempre bajo el tope aunque haya 6 secciones grandes', async () => {
	const muchos = (n, extra) => Array.from({ length: n }, (_, i) => ({ FechaControl: `2026-01-${String(i + 1).padStart(2, '0')}`, Observaciones: 'x '.repeat(200), ...extra }));
	const hcGrande = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Campo${i}`, `valor ${i} `.repeat(30)]));
	stubHttp({
		'GET /api/hc-ingreso/visita/458887': { status: 200, body: { success: true, data: [hcGrande] } },
		'GET /api/controles-frecuentes/458887/byDate': { status: 200, body: { success: true, data: muchos(30, { Valor: 9, FechaControlClarion: 1 }) } },
		'GET /api/medicacion-control/458887/byDate': { status: 200, body: { success: true, data: muchos(30) } },
		'GET /api/laboratorios/visita/458887': { status: 200, body: { success: true, data: muchos(30) } },
		'GET /api/interconsultas/458887': { status: 200, body: { success: true, data: muchos(30) } },
		'GET /api/evolucion-enfermeria/458887/byDate': { status: 200, body: { success: true, data: muchos(30) } },
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: [...PERMISOS_HC, 'INTERNACION.INTERCONSULTAS.VER', 'INTERNACION.EVOLUCION_ENFERMERIA.VER'] });
	const out = await ejecutar(
		'ver_historia_clinica',
		{ secciones: ['hc_ingreso', 'signos_vitales', 'medicacion', 'laboratorios', 'interconsultas', 'evolucion_enfermeria'], todas: true },
		ctx,
	);
	assert.equal(out.truncado, undefined, 'no pasó por el recorte genérico');
	assert.ok(JSON.stringify(out).length <= hc.TOPE_TOTAL + 300);
	const signos = out.secciones.find((s) => s.seccion === 'signos_vitales');
	assert.equal(signos.hasta, '2026-01-30');
	assert.equal(signos.total, 30);
	assert.equal(signos.resumido, true);
	assert.deepEqual(signos.registros, [], 'con 6 secciones, signos va solo como resumen');
	assert.ok(signos.resumen.notas.length >= 1);
	const enfermeria = out.secciones.find((s) => s.seccion === 'evolucion_enfermeria');
	assert.equal(enfermeria.registros[0].FechaControl, '2026-01-30', 'lo más reciente primero');
	assert.equal(enfermeria.registros[0].FechaControlClarion, undefined);
	assert.ok(out.secciones.every((s) => s.registros.length >= 1 || s.resumen));
});

test('ver_historia_clinica: período por defecto vacío trae los últimos registros y lo avisa; con días pedidos, no', async () => {
	const porDias = (req) =>
		req.query?.days === 'all'
			? { status: 200, body: { success: true, data: [{ FechaControl: '2026-02-23', Observaciones: 'diuresis 4200' }] } }
			: { status: 200, body: { success: true, data: [] } };
	stubHttp({ 'GET /api/controles-frecuentes/458887/byDate': porDias });
	const ctx = ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC });
	const out = await ejecutar('ver_historia_clinica', { secciones: ['signos_vitales'] }, ctx);
	const s = out.secciones[0];
	assert.equal(s.registros[0].FechaControl, '2026-02-23');
	assert.equal(s.periodo, 'toda la internación');
	assert.match(s.aviso, /últimos 3 días/);
	assert.deepEqual(llamadas.map((l) => l.query.days), [3, 'all']);

	stubHttp({ 'GET /api/controles-frecuentes/458887/byDate': porDias });
	const conDias = await ejecutar('ver_historia_clinica', { secciones: ['signos_vitales'], dias: 2 }, ctx);
	assert.equal(conDias.secciones[0].registros.length, 0);
	assert.match(conDias.secciones[0].aviso, /Sin registros/);
	assert.equal(llamadas.length, 1);
});

test('ver_evoluciones larga: nunca el corte genérico; resumen por profesional, la última con más texto, ids y _propio', async () => {
	const evs = Array.from({ length: 40 }, (_, i) => ({
		IdHCEvolucion: 1000 + i,
		IdVisita: 458887,
		FechaEv: `2026-02-${String(1 + (i % 28)).padStart(2, '0')}`,
		HoraEv: `${String(i % 24).padStart(2, '0')}:00`,
		IdSector: 'CM1',
		SectorDescripcion: 'CLINICA MEDICA 1',
		Evolucion: `Evolución ${i}. ${'Paciente estable, afebril, sin cambios. '.repeat(60)}`,
		Profecional: i % 2 ? 4521 : 999,
		Matricula: i % 2 ? 4521 : 999,
		ProfesionalNombreCompleto: i % 2 ? 'DRA PROPIA' : 'DR OTRO',
	}));
	stubHttp({ 'GET /api/evoluciones/458887/byDate': { status: 200, body: { success: true, data: evs } } });
	const ctx = ctxBase({ foco: focoSanabria() });
	const out = await ejecutar('ver_evoluciones', { todas: true }, ctx);
	assert.equal(out.muestra, undefined, 'no pasó por el recorte genérico');
	assert.ok(JSON.stringify(out).length <= 4000, `ve ${JSON.stringify(out).length} chars`);
	assert.equal(out.total, 40);
	assert.equal(out.resumido, true);
	assert.equal(out.resumen.totalItems, 2);
	assert.equal(out.hasta, '2026-02-28 03:00');
	const [ultima, otra] = out.registros;
	assert.equal(typeof ultima.IdHCEvolucion, 'number');
	assert.equal(typeof ultima._propio, 'boolean');
	assert.equal(ultima.Matricula, undefined);
	assert.ok(ultima.Evolucion.length > (otra?.Evolucion.length || 0), 'la más reciente con más texto');
	assert.equal(ctx.resumido, true);
});

test('ver_historia_clinica partida en varias llamadas del mismo turno: cada una siguiente recibe menos lugar', async () => {
	const muchos = (n) => Array.from({ length: n }, (_, i) => ({ FechaControl: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, Observaciones: `nota ${i} `.repeat(30), NombreMedicamento: `MED ${i % 9}`, Cantidad: 1 }));
	stubHttp({
		'GET /api/controles-frecuentes/458887/byDate': { status: 200, body: { success: true, data: muchos(80) } },
		'GET /api/medicacion-control/458887/byDate': { status: 200, body: { success: true, data: muchos(80) } },
		'GET /api/hc-ingreso/visita/458887': { status: 200, body: { success: true, data: muchos(5) } },
	});
	const ctx = ctxBase({ foco: focoSanabria(), permisos: PERMISOS_HC });
	const largos = [];
	for (const s of ['signos_vitales', 'medicacion', 'hc_ingreso', 'signos_vitales']) {
		const out = await ejecutar('ver_historia_clinica', { secciones: [s], todas: true }, ctx);
		assert.equal(out.muestra, undefined);
		largos.push(JSON.stringify(out).length);
	}
	assert.ok(largos[3] < largos[0], `la cuarta (${largos[3]}) más chica que la primera (${largos[0]})`);
	assert.ok(largos.reduce((a, b) => a + b, 0) < 10000, `total del turno ${largos.join('+')}`);
});

/* ───────────── Altas del menú médico ───────────── */

const CONTEXTO_SANABRIA = () => contextoClinico(SANABRIA.paciente, { sector: 'QUR2', numeroCama: '04' });

const FORMULARIO_INDICACIONES = {
	status: 200,
	body: {
		success: true,
		data: {
			tiposIndicacion: [
				{ Valor: 6, Descripcion: 'CONTROL', Tipo: 'C', OrdenMedicacion: 5 },
				{ Valor: 11, Descripcion: 'MEDIDAS ASISTENCIALES', Tipo: 'A', OrdenMedicacion: 15 },
				{ Valor: 5, Descripcion: 'DIETA', Tipo: 'D', OrdenMedicacion: 10 },
				{ Valor: 14, Descripcion: 'ALIMENTACION ENTERAL', Tipo: 'D', OrdenMedicacion: 10 },
				{ Valor: 2, Descripcion: 'MEDICACION ENDOVENOSA', Tipo: 'M', OrdenMedicacion: 40 },
			],
			tiposControles: [
				{ Valor: 15, Descripcion: 'PULSO+FREC RESP+PRESION+TEMP' },
				{ Valor: 3, Descripcion: 'PRESION ARTERIAL' },
				{ Valor: 12, Descripcion: 'NEBULIZACIONES' },
			],
			controlesAsistenciales: [
				{ Valor: 4, Descripcion: 'OXIGENO HUMEDO A DEMANDA' },
				{ Valor: 5, Descripcion: 'OXIGENO HUMEDO CONTINUO' },
			],
			tiposDieta: [
				{ Valor: 3, Descripcion: 'HIPOSODICO' },
				{ Valor: 15, Descripcion: 'ALIMENTACION ENTERAL' },
			],
			frecuenciasAdmin: [
				{ Valor: 'CADA 8 HS           ', Intervalo: 2880001 },
				{ Valor: '1 VEZ AL DIA        ', Intervalo: 8640000 },
				{ Valor: 'CADA 6 HS           ', Intervalo: 2160001 },
			],
		},
	},
};

async function altaDe(tool, args, extraStubs = {}, ctxExtra = {}) {
	pendientes.resetStore();
	stubHttp({ 'GET /api/patients/visitas/458887/contexto-clinico': CONTEXTO_SANABRIA(), ...extraStubs });
	const ctx = ctxBase({ permisos: PERMISOS_CREAR, foco: focoSanabria(), ...ctxExtra });
	const out = await ejecutar(tool, args, ctx);
	const item = out.idPendiente ? pendientes.peek(out.idPendiente, 1, 10) : null;
	return { out, item, ctx };
}

test('preparar_indicacion: «signos vitales cada 8 horas» → control del catálogo, 32 campos, tarjeta POST', async () => {
	const { out, item } = await altaDe(
		'preparar_indicacion',
		{ item: 'signos vitales', frecuencia: 'cada 8 horas' },
		{ 'GET /api/indicaciones/formulario/datos': FORMULARIO_INDICACIONES },
	);
	assert.equal(out.requiereConfirmacion, true);
	assert.match(out.resumen, /SANABRIA ELIZABETH \(visita 458887, cama 04\): CONTROL · PULSO\+FREC RESP\+PRESION\+TEMP · CADA 8 HS/);
	assert.equal(item.http.method, 'POST');
	assert.equal(item.http.path, '/api/indicaciones');
	const b = item.http.body;
	assert.equal(Object.keys(b).length, 31, 'los 31 campos que valida el controller (null permitido, ausente no)');
	assert.equal(b.TipoIndicacion, 6);
	assert.equal(b.Codigo, 15);
	assert.equal(b.Frecuencia, 'CADA 8 HS           ');
	assert.equal(b.CantidadIndicada, 1);
	assert.equal(b.Cantidad, 3);
	assert.equal(b.IdSector, 'QUR2');
	assert.equal(b.AliasMedicamento, 'PULSO+FREC RESP+PRESION+TEMP');
	assert.equal(typeof b.ExcluidoDeEntrega, 'object');
	assert.ok(llamadas.every((l) => l.method === 'GET'));
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('preparar_indicacion: medicación no se indica desde el chat; ambiguo pide opciones; dieta sin frecuencia', async () => {
	const med = await altaDe('preparar_indicacion', { item: 'ceftriaxona 1 g endovenosa cada 12 hs' });
	assert.match(med.out.error, /medicación no se indica/);
	assert.equal(med.ctx.pendientes.length, 0);

	const oxi = await altaDe('preparar_indicacion', { item: 'oxígeno', frecuencia: 'cada 6 hs' }, { 'GET /api/indicaciones/formulario/datos': FORMULARIO_INDICACIONES });
	assert.equal(oxi.out.pedir, 'medidas asistenciales');
	assert.deepEqual(oxi.out.opciones, ['OXIGENO HUMEDO A DEMANDA', 'OXIGENO HUMEDO CONTINUO']);
	assert.equal(oxi.ctx.pendientes.length, 0);

	const sinFrec = await altaDe('preparar_indicacion', { item: 'presión arterial' }, { 'GET /api/indicaciones/formulario/datos': FORMULARIO_INDICACIONES });
	assert.equal(sinFrec.out.pedir, 'frecuencia');
	assert.ok(sinFrec.out.opciones.includes('CADA 8 HS'));

	const dieta = await altaDe('preparar_indicacion', { item: 'dieta hiposódica' }, { 'GET /api/indicaciones/formulario/datos': FORMULARIO_INDICACIONES });
	assert.equal(dieta.item.http.body.TipoIndicacion, 5);
	assert.equal(dieta.item.http.body.Codigo, 3);
	assert.equal(dieta.item.http.body.Frecuencia, null);
	pendientes.cancelar(dieta.out.idPendiente, 1, 10);
});

const PRACTICAS = [
	{ idTipoPedido: 59, descripcion: 'RADIOGRAFIA DE TORAX (PRIMERA EXPOSICION O FRENTE)\r\n', idPractica: 340301 },
	{ idTipoPedido: 60, descripcion: 'RADIOGRAFIA DE TORAX (EXPOSICION SUBSIGUIENTE, PERFIL U OBLICUA)\r\n', idPractica: 340302 },
	{ idTipoPedido: 13, descripcion: 'TC DE TORAX SIN CONTRASTE', idPractica: 341010 },
];
const SERVICIOS = {
	status: 200,
	body: {
		success: true,
		data: [
			{ valor: 'CAR', descripcion: 'CARDIOLOGIA', prefijos: ['42'] },
			{ valor: 'CLI', descripcion: 'CLINICA MEDICA', prefijos: ['42'] },
			{ valor: 'QUIR', descripcion: 'CLINICA QUIRURGICA', prefijos: ['42'] },
			{ valor: 'RAY', descripcion: 'RAYOS', prefijos: ['42', '34'] },
		],
	},
};
const stubsEstudios = {
	'GET /api/estudios/tipos/buscar': (req) => {
		const q = String(req.query?.q || '');
		const hits = PRACTICAS.filter((p) => q.split(' ').every((t) => p.descripcion.toLowerCase().includes(t)));
		return { status: 200, body: { success: true, data: hits } };
	},
	'GET /api/estudios/sectores-receptor': SERVICIOS,
};

test('solicitar_estudios: una práctica → POST /api/estudios al servicio deducido; dos → solicitud con items', async () => {
	const uno = await altaDe('solicitar_estudios', { estudios: ['rx de tórax frente'], urgencia: 'Urgente' }, stubsEstudios);
	assert.equal(uno.item.http.path, '/api/estudios');
	assert.equal(uno.item.http.body.idPractica, 340301);
	assert.equal(uno.item.http.body.idSectorReceptor, 'RAY');
	assert.equal(uno.item.http.body.estadoUrgencia, 'Urgente');
	assert.match(uno.out.resumen, /a RAYOS · Urgente/);
	pendientes.cancelar(uno.out.idPendiente, 1, 10);

	const dos = await altaDe('solicitar_estudios', { estudios: ['rx de tórax frente', 'tac de tórax sin contraste'] }, stubsEstudios);
	assert.equal(dos.item.http.path, '/api/solicitudes-estudios');
	assert.deepEqual(dos.item.http.body.items, [
		{ idTipoPedido: 59, idPractica: 340301 },
		{ idTipoPedido: 13, idPractica: 341010 },
	]);
	pendientes.cancelar(dos.out.idPendiente, 1, 10);

	const vago = await altaDe('solicitar_estudios', { estudios: ['rx de tórax'] }, stubsEstudios);
	assert.ok(vago.out.pedir);
	assert.equal(vago.out.opciones.length, 2);
	assert.equal(vago.ctx.pendientes.length, 0);
});

test('solicitar_interconsulta: servicio por nombre parcial, motivo marcado como IA; «clínica» ambiguo pregunta', async () => {
	const stubs = { 'GET /api/interconsultas/sectores-destino': SERVICIOS };
	const { out, item } = await altaDe('solicitar_interconsulta', { servicio: 'cardio', motivo: 'FA de reciente comienzo, evaluación' }, stubs);
	assert.equal(item.http.path, '/api/interconsultas');
	assert.equal(item.http.body.idSectorReceptor, 'CAR');
	assert.equal(item.http.body.idVisita, 458887);
	assert.deepEqual(item.generativo, ['motivo']);
	assert.match(out.resumen, /interconsulta a CARDIOLOGIA para SANABRIA ELIZABETH/);
	pendientes.cancelar(out.idPendiente, 1, 10);

	const amb = await altaDe('solicitar_interconsulta', { servicio: 'clínica', motivo: 'control' }, stubs);
	assert.deepEqual(amb.out.opciones, ['CLINICA MEDICA', 'CLINICA QUIRURGICA']);
});

test('preparar_hc_ingreso: columnas imHCI del modal, avisa si ya hay una HC', async () => {
	const { out, item } = await altaDe(
		'preparar_hc_ingreso',
		{
			motivoConsulta: 'Disnea',
			enfermedadActual: 'Paciente con disnea de 3 días de evolución.',
			signosVitales: { ta: '130/80', fc: '96' },
			examenFisico: { respiratorio: 'Rales bibasales' },
			impresionDiagnostica: 'Neumonía',
			planDiagnostico: ['Rx de tórax', 'Hemocultivos'],
		},
		{ 'GET /api/hc-ingreso/visita/458887': { status: 200, body: { success: true, data: [{ Fecha: '2026-10-01T10:00:00' }] } } },
	);
	const b = item.http.body;
	assert.equal(item.http.path, '/api/hc-ingreso');
	assert.equal(b.NumeroVisita, 458887);
	assert.equal(b.IdSector, 'QUR2');
	assert.equal(b.SV_PA, '130/80');
	assert.equal(b.SV_FC, '96');
	assert.equal(b.AR_TEXTO, 'Rales bibasales');
	assert.equal(b.PD_A, 'Rx de tórax');
	assert.equal(b.PD_B, 'Hemocultivos');
	assert.deepEqual(item.generativo, ['EnfermedadActual']);
	assert.match(out.resumen, /ya tiene una del 2026-10-01/);
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('preparar_protocolo: el usuario queda como especialista, sin medicamentos; sin texto no arma nada', async () => {
	const stubs = {
		'GET /api/protocolos/practicas/buscar': {
			status: 200,
			body: { success: true, data: [{ idPractica: 120301, tipoPractica: 'NO', descripcion: 'COLOCACION DE CATETER VENOSO CENTRAL' }] },
		},
	};
	const req = { headers: {}, matricula: 4521, valorPersonal: 777 };
	const { out, item } = await altaDe(
		'preparar_protocolo',
		{ practica: 'catéter venoso central', texto: 'Se coloca CVC yugular derecho sin complicaciones.', horaFin: '10:40' },
		stubs,
		{ req },
	);
	const b = item.http.body;
	assert.equal(item.http.path, '/api/protocolos');
	assert.deepEqual(b.practicas[0].profesionales, [{ valorPersonal: 777, funcion: 1 }]);
	assert.equal(b.practicas[0].idPractica, 120301);
	assert.deepEqual(b.medicamentos, []);
	assert.match(b.fechaHoraFin, /T10:40$/);
	assert.match(out.resumen, /facturable/);
	pendientes.cancelar(out.idPendiente, 1, 10);

	const sinTexto = await altaDe('preparar_protocolo', { practica: 'cvc', texto: '' }, stubs, { req });
	assert.match(sinTexto.out.error, /descripción del procedimiento/);
});

test('preparar_protocolo: la práctica (facturable) no se elige por aproximación; con el código elegido sí', async () => {
	const req = { headers: {}, matricula: 4521, valorPersonal: 777 };
	const texto = 'Punción lumbar L3-L4 sin complicaciones, líquido claro.';
	const PUNCIONES = [
		{ idPractica: 70704, descripcion: '*AC-AORTOGRAFIA POR PUNCION LUMBAR.' },
		{ idPractica: 15010, descripcion: 'PUNCION LUMBAR (SPS)' },
		{ idPractica: 10309, descripcion: 'PUNCION LUMBAR CON O SIN MANOMETRIA.' },
	];
	const buscar = (data) => ({
		'GET /api/protocolos/practicas/buscar': (r) => {
			assert.equal(r.query.q, 'puncion lumbar', 'busca la frase entera, no solo la palabra más larga');
			return { status: 200, body: { success: true, data } };
		},
	});

	const varias = await altaDe('preparar_protocolo', { practica: 'punción lumbar', texto }, buscar(PUNCIONES), { req });
	assert.equal(varias.out.pedir, 'práctica');
	assert.ok(varias.out.opciones.includes('PUNCION LUMBAR (SPS) · 15010'));
	assert.equal(varias.item, null);

	const unaLejana = await altaDe('preparar_protocolo', { practica: 'punción lumbar', texto }, buscar(PUNCIONES.slice(0, 1)), { req });
	assert.equal(unaLejana.out.pedir, 'práctica', '«AORTOGRAFIA POR PUNCION LUMBAR» no es «punción lumbar»');
	assert.equal(unaLejana.item, null);

	const elegida = await altaDe(
		'preparar_protocolo',
		{ practica: 'PUNCION LUMBAR (SPS) · 15010', texto },
		{ 'GET /api/protocolos/practicas/15010': { status: 200, body: { success: true, data: PUNCIONES[1] } } },
		{ req },
	);
	assert.equal(elegida.item.http.body.practicas[0].idPractica, 15010);
	pendientes.cancelar(elegida.out.idPendiente, 1, 10);
});

test('preparar_epicrisis: diagnóstico por código del catálogo y marca IA', async () => {
	const { out, item } = await altaDe(
		'preparar_epicrisis',
		{ texto: 'Paciente que cursó internación por neumonía con buena evolución.', diagnostico: 'J18.9' },
		{
			'GET /api/agenda/diagnosticos/buscar': {
				status: 200,
				body: { success: true, data: [{ valor: 1, codigo: 'J18.9', descripcion: 'NEUMONIA NO ESPECIFICADA' }] },
			},
		},
	);
	assert.equal(item.http.path, '/api/epicrisis');
	assert.equal(item.http.body.Diagnostico, 'J18.9');
	assert.equal(item.http.body.DiagnosticoText, 'NEUMONIA NO ESPECIFICADA');
	assert.deepEqual(item.generativo, ['Epicrisis']);
	assert.match(out.resumen, /Dx J18\.9/);
	pendientes.cancelar(out.idPendiente, 1, 10);
});

test('altas sobre una visita egresada: error, sin tarjeta', async () => {
	pendientes.resetStore();
	stubHttp({ 'GET /api/patients/visitas/458887/contexto-clinico': contextoClinico(SANABRIA.paciente, { egresada: true }) });
	const ctx = ctxBase({ permisos: PERMISOS_CREAR, foco: focoSanabria() });
	const out = await ejecutar('solicitar_interconsulta', { servicio: 'cardio', motivo: 'control' }, ctx);
	assert.match(out.error, /egresada/);
	assert.equal(ctx.pendientes.length, 0);
});
