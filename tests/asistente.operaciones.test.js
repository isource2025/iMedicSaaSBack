const test = require('node:test');
const assert = require('node:assert/strict');
const operaciones = require('../src/asistente/operaciones');
const catalogo = require('../src/asistente/catalogo');
const manifiesto = require('../src/asistente/manifiesto');
const { ejecutar } = require('../src/asistente/ejecutar');
const pendientes = require('../src/asistente/pendientes');
const permisosService = require('../src/services/permisos.service');

test('cada handler del código es una operación con nombre de función', () => {
	const op = operaciones.porNombre('registrarEgresoPaciente');
	assert.ok(op);
	assert.equal(op.metodo, 'POST');
	assert.equal(op.path, '/api/patients/visitas/egreso');
	assert.ok(op.campos.body.includes('numeroVisita'));
	assert.ok(op.campos.body.includes('disposicionEgreso'));
	assert.match(op.para, /alta|egreso/i);
});

test('el manifiesto encuentra el handler de egreso por términos del proceso', () => {
	const hits = manifiesto.buscar({ texto: 'egreso internado', modulo: 'INTERNACION', limite: 10 });
	assert.ok(hits.some((e) => /egreso/i.test(e.path) && e.metodo === 'POST'));
	const names = catalogo.HERRAMIENTAS.map((h) => h.name);
	assert.ok(names.includes('llamar_api'));
	assert.ok(names.includes('buscar_en_manual'));
	assert.ok(!names.includes('egresar_paciente'));
	assert.ok(!names.includes('registrarEgresoPaciente'));
});

test('Soporte solo expone tools de manual/pantalla; no hay tools por pantalla clínica', () => {
	const base = {
		permisos: ['INTERNACION.MOVIMIENTOS.GESTIONAR', 'INTERNACION.CAMAS.VER'],
		moduloActual: 'INTERNACION',
		tienePermiso: permisosService.tienePermiso,
		agente: 'SOPORTE',
	};
	const busca = catalogo.seleccionar({ ...base }).map((h) => h.name);
	assert.ok(busca.includes('buscar_en_manual'));
	assert.ok(busca.includes('listar_pantallas'));
	assert.ok(busca.includes('navegar'));
	assert.ok(busca.includes('escribir_en_campo'));
	assert.ok(!busca.includes('llamar_api'));
	assert.ok(!busca.includes('buscar_codigo'));
	assert.ok(!busca.includes('egresar_paciente'));
	assert.ok(!busca.includes('buscar_pacientes'));
});

test('llamar_api deja la escritura pendiente', async () => {
	pendientes.resetStore();
	const ctx = {
		permisos: ['INTERNACION.MOVIMIENTOS.GESTIONAR'],
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: 1,
		valorPersonal: 10,
		token: 't',
		req: { headers: {}, rolNombre: 'ADMIN' },
		navegaciones: [],
		pendientes: [],
		consultas: [],
	};
	const out = await ejecutar(
		'llamar_api',
		{
			metodo: 'POST',
			path: '/api/patients/visitas/egreso',
			body: {
				numeroVisita: 479635,
				disposicionEgreso: 1,
				fechaEgreso: '2026-10-11',
				horaEgreso: '20:00',
			},
			resumen: 'Egresar a Gómez',
		},
		ctx,
	);
	assert.equal(out.requiereConfirmacion, true);
	assert.equal(ctx.pendientes.length, 1);
	assert.equal(ctx.pendientes[0].metodo, 'POST');
});
