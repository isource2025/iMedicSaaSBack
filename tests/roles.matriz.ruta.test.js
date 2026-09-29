/**
 * Matriz de permisos: las rutas de administracion de roles sólo las pueden usar
 * quienes tengan CONFIGURACION.ROLES.* (Admin) y el controlador traduce bien los errores.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const matriz = require(src('utils/permisos.js'));

let rolSimulado = 'ADMIN';
const resuelta = require.resolve(src('services/permisos.service.js'));
const real = require(resuelta);
require.cache[resuelta].exports = {
	...real,
	permisosDeUsuario: async () => ({ permisos: matriz.permisosDeRol(rolSimulado) }),
};

// Servicio de roles personalizados sustituido (sin base de datos)
const llamadas = [];
let fallo = null;
const servicioPath = require.resolve(src('services/rolesCustom.service.js'));
require.cache[servicioPath] = {
	id: servicioPath,
	filename: servicioPath,
	loaded: true,
	exports: {
		listarMatriz: async (idEmpresa) => {
			llamadas.push(['listarMatriz', idEmpresa]);
			return { soportaPersonalizados: true, esquemaListo: true, sistema: [], personalizados: [] };
		},
		crearRol: async (p) => {
			llamadas.push(['crearRol', p]);
			if (fallo) throw fallo;
			return { idRol: 1000, nombre: p.nombre, permisos: p.permisos };
		},
		eliminarRol: async (id) => {
			llamadas.push(['eliminarRol', id]);
			return { idRol: id };
		},
		registrarAsignacion: async () => {},
	},
};

const router = require(src('routes/roles.routes.js'));
const ctrl = require(src('controllers/rolesMatriz.controller.js'));

async function pasa(metodo, ruta, rol) {
	rolSimulado = rol;
	const capa = router.stack.find((l) => l.route && l.route.path === ruta && l.route.methods[metodo]);
	assert.ok(capa, `no existe la ruta ${metodo} ${ruta}`);
	// Sólo el middleware de permisos (se omite requireAuth/requireTenant y el handler)
	const guardia = capa.route.stack[2].handle;
	const req = { auth: { rol: { nombre: rol } }, rolNombre: rol, valorPersonal: 1 };
	let status = 200;
	let siguio = false;
	const res = { status(c) { status = c; return this; }, json() { return this; } };
	await guardia(req, res, () => { siguio = true; });
	return { ok: siguio, status };
}

const RUTAS = [
	['get', '/matriz'],
	['post', '/'],
	['put', '/:id(\\d+)'],
	['post', '/:id(\\d+)/duplicar'],
	['delete', '/:id(\\d+)'],
	['get', '/:id(\\d+)/usuarios'],
	['get', '/:id(\\d+)/auditoria'],
];

for (const [metodo, ruta] of RUTAS) {
	test(`ADMIN accede a ${metodo.toUpperCase()} /roles${ruta}`, async () => {
		assert.equal((await pasa(metodo, ruta, 'ADMIN')).ok, true);
	});
	for (const rol of ['MEDICO', 'ENFERMERO', 'ADMINISTRATIVO', 'CARGA_HC', 'PANEL_DATOS']) {
		test(`${rol} NO accede a ${metodo.toUpperCase()} /roles${ruta}`, async () => {
			const r = await pasa(metodo, ruta, rol);
			assert.equal(r.ok, false);
			assert.equal(r.status, 403);
		});
	}
}

function ejecutar(fn, req) {
	return new Promise((resolve) => {
		const res = {
			statusCode: 200,
			status(c) { this.statusCode = c; return this; },
			json(b) { resolve({ status: this.statusCode, body: b }); },
		};
		fn(req, res);
	});
}

test('GET matriz devuelve roles y catalogo con descripciones', async () => {
	const r = await ejecutar(ctrl.matriz, { idEmpresa: 7, permisos: ['A.B.VER'] });
	assert.equal(r.status, 200);
	assert.equal(r.body.success, true);
	assert.ok(Array.isArray(r.body.data.catalogo) && r.body.data.catalogo.length > 0);
	assert.deepEqual(r.body.data.permisosActor, ['A.B.VER']);
	assert.deepEqual(llamadas.at(-1), ['listarMatriz', 7]);
});

test('sin empresa activa responde 400', async () => {
	const r = await ejecutar(ctrl.matriz, {});
	assert.equal(r.status, 400);
});

test('crear pasa la empresa y el actor (con sus permisos) al servicio', async () => {
	fallo = null;
	const r = await ejecutar(ctrl.crear, {
		idEmpresa: 7,
		valorPersonal: 55,
		permisos: ['X.Y.VER'],
		body: { nombre: 'Recepcion', permisos: ['X.Y.VER'] },
	});
	assert.equal(r.status, 200);
	const [, p] = llamadas.at(-1);
	assert.equal(p.idEmpresa, 7);
	assert.equal(p.actor.valorPersonal, 55);
	assert.deepEqual(p.actor.permisos, ['X.Y.VER']);
});

test('los errores del servicio conservan su codigo HTTP', async () => {
	fallo = Object.assign(new Error('Ya existe un rol con ese nombre'), { statusCode: 409 });
	const r = await ejecutar(ctrl.crear, { idEmpresa: 7, body: { nombre: 'x' } });
	fallo = null;
	assert.equal(r.status, 409);
	assert.equal(r.body.mensaje, 'Ya existe un rol con ese nombre');
});

test('un error inesperado no expone detalles internos', async () => {
	fallo = new Error('ER_SECRET_SQL detalle interno');
	const r = await ejecutar(ctrl.crear, { idEmpresa: 7, body: { nombre: 'x' } });
	fallo = null;
	assert.equal(r.status, 500);
	assert.doesNotMatch(r.body.mensaje, /SECRET/);
});

test('id invalido en la ruta responde 400', async () => {
	const r = await ejecutar(ctrl.eliminar, { idEmpresa: 7, params: { id: 'abc' } });
	assert.equal(r.status, 400);
});
