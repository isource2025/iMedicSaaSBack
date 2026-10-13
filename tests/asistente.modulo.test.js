const test = require('node:test');
const assert = require('node:assert/strict');
const catalogo = require('../src/asistente/catalogo');
const { pathConocido } = require('../src/asistente/ejecutar');
const { moduloDeRuta, extraerEntidadesRuta } = require('../src/asistente/contexto');
const manual = require('../src/asistente/manual');
const pendientes = require('../src/asistente/pendientes');
const recortar = require('../src/asistente/recortar');
const { construirSystemPrompt } = require('../src/asistente/prompt');
const permisosService = require('../src/services/permisos.service');

test('catálogo: nombres únicos y schemas válidos', () => {
	const names = catalogo.HERRAMIENTAS.map((h) => h.name);
	assert.equal(new Set(names).size, names.length);
	for (const h of catalogo.HERRAMIENTAS) {
		assert.ok(h.description.length > 10, h.name);
		assert.equal(h.parameters.type, 'object');
		if (h.http) {
			const spec = h.http({
				termino: 'a',
				id: 1,
				numeroVisita: '10',
				estado: 'LIBRE',
				fecha: '2026-10-10',
				codigo: 'X',
				pregunta: 'x',
				path: '/dashboard',
			});
			assert.match(spec.path, /^\/api\//);
			assert.match(spec.method, /^(GET|POST|PUT|PATCH|DELETE)$/);
			if (h.mutante) assert.notEqual(spec.method, 'GET');
		}
	}
});

test('selección filtra por permiso y prioriza el módulo actual', () => {
	const permisos = ['ADMISION.PACIENTES.VER', 'INTERNACION.CAMAS.VER'];
	const sel = catalogo.seleccionar({
		permisos,
		moduloActual: 'ADMISION',
		tienePermiso: permisosService.tienePermiso,
	});
	const names = sel.map((h) => h.name);
	assert.ok(names.includes('buscar_en_manual'));
	assert.ok(names.includes('navegar'));
	assert.ok(names.includes('listar_pantallas'));
	assert.ok(names.includes('escribir_en_campo'));
	assert.ok(!names.includes('llamar_api'));
	assert.ok(!names.includes('buscar_codigo'));
	assert.ok(!names.includes('buscar_pacientes'));
	assert.ok(!names.includes('listar_personal'));
	assert.ok(!names.includes('actualizar_estado_cama'));
	assert.ok(!names.includes('egresar_paciente'));
});

test('navegar solo acepta pantallas del tenant', () => {
	assert.equal(pathConocido('/dashboard/patients'), true);
	assert.equal(pathConocido('/dashboard/beds/12'), true);
	assert.equal(pathConocido('/dashboard/super-admin/empresas'), false);
	assert.equal(pathConocido('https://evil.example'), false);
	assert.equal(pathConocido('/api/patients'), false);
});

test('moduloDeRuta y entidades', () => {
	assert.equal(moduloDeRuta('/dashboard/turnos/agenda'), 'TURNOS');
	assert.equal(moduloDeRuta('/dashboard/beds/88'), 'INTERNACION');
	assert.deepEqual(extraerEntidadesRuta('/dashboard/beds/88'), { idCama: '88', numeroVisita: null });
	assert.deepEqual(extraerEntidadesRuta('/dashboard/visita/1201'), {
		idCama: null,
		numeroVisita: '1201',
	});
});

test('manual encuentra artículos por tags', () => {
	const hits = manual.buscar('cómo admitir un paciente');
	assert.ok(hits.length >= 1);
	assert.ok(hits.some((h) => h.path.includes('admission') || h.id === 'nueva-admision'));
});

test('pendientes aíslan por usuario y se consumen una vez', () => {
	pendientes.resetStore();
	const a = pendientes.crear({
		idEmpresa: 1,
		valorPersonal: 10,
		herramienta: 'actualizar_estado_cama',
		args: { id: 3 },
		http: { method: 'PUT', path: '/api/beds/3/status', body: { estado: 'L' } },
		resumen: 'cambiar cama',
	});
	assert.equal(pendientes.peek(a.id, 1, 99), null);
	assert.ok(pendientes.peek(a.id, 1, 10));
	const taken = pendientes.tomar(a.id, 1, 10);
	assert.equal(taken.herramienta, 'actualizar_estado_cama');
	assert.equal(pendientes.tomar(a.id, 1, 10), null);
});

test('recortar.deApi acota errores y listas', () => {
	const err = recortar.deApi({ status: 403, body: { mensaje: 'Permiso requerido: X' } });
	assert.equal(err.error, 'Permiso requerido: X');
	const ok = recortar.deApi(
		{
			status: 200,
			body: { success: true, data: Array.from({ length: 40 }, (_, i) => ({ IdCama: i, secreto: 'no' })) },
		},
		['IdCama'],
	);
	assert.equal(ok.total, 40);
	assert.equal(ok.items.length, recortar.MAX_ITEMS ?? 25);
	assert.equal(ok.items[0].secreto, undefined);
});

test('system prompt no pide tenant al modelo', () => {
	const p = construirSystemPrompt({
		rol: 'MEDICO',
		rutaActual: '/dashboard/beds',
		moduloActual: 'INTERNACION',
		entidades: { idCama: '9' },
		herramientas: [{ name: 'navegar' }],
		agente: 'SOPORTE',
		instrucciones: 'Sos el agente de SOPORTE de iMedic.',
	});
	assert.match(p, /idEmpresa/);
	assert.match(p, /cama abierta: 9/);
	assert.match(p, /navegar/);
	assert.match(p, /SOPORTE/);
});
