const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutar } = require('../src/asistente/ejecutar');
const pendientes = require('../src/asistente/pendientes');
const permisosService = require('../src/services/permisos.service');

function ctxBase(extra) {
	return {
		permisos: ['ADMISION.PACIENTES.VER', 'INTERNACION.CAMAS.GESTIONAR'],
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: 1,
		valorPersonal: 10,
		token: 't',
		req: { headers: {} },
		navegaciones: [],
		pendientes: [],
		...extra,
	};
}

test('buscar_en_manual y navegar no pegan a HTTP', async () => {
	const ctx = ctxBase();
	const manual = await ejecutar('buscar_en_manual', { pregunta: 'cómo ver camas' }, ctx);
	assert.ok(manual.articulos.length >= 1);

	const nav = await ejecutar('navegar', { path: '/dashboard/beds', motivo: 'mapa' }, ctx);
	assert.equal(nav.ok, true);
	assert.equal(ctx.navegaciones[0].href, '/dashboard/beds');
});

test('navegar bloquea super-admin', async () => {
	const out = await ejecutar('navegar', { path: '/dashboard/super-admin' }, ctxBase());
	assert.match(out.error, /no permitida/i);
});

test('mutante crea pendiente y no ejecuta', async () => {
	pendientes.resetStore();
	const ctx = ctxBase({ permisos: ['INTERNACION.CAMAS.GESTIONAR'] });
	const out = await ejecutar(
		'llamar_api',
		{ metodo: 'PUT', path: '/api/beds/4/status', body: { estado: 'L' }, resumen: 'Liberar cama' },
		ctx,
	);
	assert.equal(out.requiereConfirmacion, true);
	assert.ok(out.idPendiente);
	assert.equal(ctx.pendientes.length, 1);
	assert.ok(pendientes.peek(out.idPendiente, 1, 10));
});

test('herramienta sin permiso se rechaza', async () => {
	const out = await ejecutar(
		'llamar_api',
		{ metodo: 'GET', path: '/api/personal' },
		ctxBase({ permisos: [] }),
	);
	assert.match(out.error, /Sin permiso/);
});
