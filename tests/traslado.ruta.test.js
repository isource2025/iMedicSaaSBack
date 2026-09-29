/**
 * Las rutas de traslado de cama (mover / intercambiar / asignar) deben dejar
 * pasar a quien tenga TRASLADAR (Enfermero) y seguir exigiendo GESTIONAR para
 * egreso y edición del último movimiento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const matriz = require(src('utils/permisos.js'));

// permisos.service sustituido: devuelve la plantilla del rol simulado
let rolSimulado = 'ENFERMERO';
const resuelta = require.resolve(src('services/permisos.service.js'));
const real = require(resuelta);
require.cache[resuelta].exports = {
	...real,
	permisosDeUsuario: async () => ({ permisos: matriz.permisosDeRol(rolSimulado) }),
};

const movimientos = require(src('routes/visitaMovimientos.routes.js'));
const pacientes = require(src('routes/patients.routes.js'));

/** Busca la ruta y ejecuta sólo su middleware de permisos (todos menos el último handler). */
async function pasa(router, metodo, ruta, rol) {
	rolSimulado = rol;
	const capa = router.stack.find(
		(l) => l.route && l.route.path === ruta && l.route.methods[metodo],
	);
	assert.ok(capa, `no existe la ruta ${metodo} ${ruta}`);
	const guardias = capa.route.stack.slice(0, -1).map((s) => s.handle);
	const req = { auth: { rol: { nombre: rol } }, rolNombre: rol, valorPersonal: 1 };
	let status = 200;
	let llego = false;
	const res = { status(c) { status = c; return this; }, json() { return this; } };
	for (const g of guardias) {
		let siguio = false;
		await g(req, res, () => { siguio = true; });
		if (!siguio) return { ok: false, status };
		llego = true;
	}
	return { ok: true, status, llego };
}

const RUTAS_TRASLADO = [
	[movimientos, 'post', '/mover/:numeroVisita'],
	[movimientos, 'post', '/asignar/:numeroVisita'],
	[movimientos, 'post', '/intercambiar/:numeroVisita1/:numeroVisita2'],
	[pacientes, 'put', '/visitas/:numeroVisita/mover-cama'],
	[pacientes, 'post', '/visitas/:numeroVisita/asignar-cama'],
	[pacientes, 'put', '/visitas/:numeroVisita1/intercambiar-cama/:numeroVisita2'],
];

for (const [router, metodo, ruta] of RUTAS_TRASLADO) {
	test(`ENFERMERO puede ${metodo.toUpperCase()} ${ruta}`, async () => {
		assert.equal((await pasa(router, metodo, ruta, 'ENFERMERO')).ok, true);
	});
	test(`CARGA_HC NO puede ${metodo.toUpperCase()} ${ruta}`, async () => {
		const r = await pasa(router, metodo, ruta, 'CARGA_HC');
		assert.equal(r.ok, false);
		assert.equal(r.status, 403);
	});
}

test('ENFERMERO NO puede registrar egreso (sigue exigiendo GESTIONAR)', async () => {
	const r = await pasa(pacientes, 'post', '/visitas/egreso', 'ENFERMERO');
	assert.equal(r.ok, false);
	assert.equal(r.status, 403);
});

test('ENFERMERO NO puede editar el último movimiento', async () => {
	const r = await pasa(movimientos, 'put', '/ultimo/:numeroVisita', 'ENFERMERO');
	assert.equal(r.ok, false);
});

test('ADMINISTRATIVO y MEDICO siguen pudiendo trasladar', async () => {
	assert.equal((await pasa(movimientos, 'post', '/mover/:numeroVisita', 'ADMINISTRATIVO')).ok, true);
	assert.equal((await pasa(movimientos, 'post', '/mover/:numeroVisita', 'MEDICO')).ok, true);
});
