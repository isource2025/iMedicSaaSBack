/**
 * Asignación de roles: protección contra escalada de privilegios.
 * Se prueban los handlers reales con los servicios sustituidos (sin base de datos).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// Estado que controlan los tests
const estado = { actuales: [], esAdmin: false, asignado: null };

function inyectar(ruta, exports) {
	const resuelta = require.resolve(src(ruta));
	require.cache[resuelta] = { id: resuelta, filename: resuelta, loaded: true, exports };
}

inyectar('services/roles.service.js', {
	listarRoles: async () => [],
	obtenerRolPorId: async () => null,
	obtenerRolesDePersonal: async () => ({ roles: estado.actuales.map((id) => ({ IdRol: id })) }),
	asignarRolesAPersonal: async (vp, ids, principal) => {
		estado.asignado = { vp, ids, principal };
		const roles = ids.map((id) => ({ IdRol: id, Nombre: `R${id}`, EsPrincipal: id === principal }));
		return { roles, principal: roles.find((r) => r.EsPrincipal) || roles[0] || null };
	},
	asignarRolAPersonal: async (vp, id) => {
		estado.asignado = { vp, ids: id ? [id] : [], principal: id };
		return id ? { IdRol: id, Nombre: `R${id}` } : null;
	},
});
inyectar('middlewares/propietario.middleware.js', { esAdminClinico: async () => estado.esAdmin });

const ctrl = require(src('controllers/roles.controller.js'));

function ejecutar({ body, rol = { id: 1, nombre: 'ADMIN' }, actuales = [], esAdmin = true }) {
	estado.actuales = actuales;
	estado.esAdmin = esAdmin;
	estado.asignado = null;
	const req = {
		params: { valor: '10' },
		body,
		auth: { rol },
		rolNombre: rol.nombre,
	};
	return new Promise((resolve) => {
		const res = {
			statusCode: 200,
			status(c) { this.statusCode = c; return this; },
			json(b) { resolve({ status: this.statusCode, body: b }); },
		};
		ctrl.asignarAPersonal(req, res);
	});
}

test('un admin puede asignar roles comunes', async () => {
	const r = await ejecutar({ body: { idRoles: [2, 7], idRolPrincipal: 2 } });
	assert.equal(r.status, 200);
	assert.deepEqual(estado.asignado.ids, [2, 7]);
});

test('guardar sin tocar ADMIN no se bloquea aunque el actor no sea admin', async () => {
	const r = await ejecutar({
		body: { idRoles: [1, 2], idRolPrincipal: 1 },
		actuales: [1, 2],
		rol: { id: 4, nombre: 'ADMINISTRATIVO' },
		esAdmin: false,
	});
	assert.equal(r.status, 200);
});

test('un no-admin NO puede otorgar el rol ADMIN', async () => {
	const r = await ejecutar({
		body: { idRoles: [4, 1], idRolPrincipal: 4 },
		actuales: [4],
		rol: { id: 4, nombre: 'ADMINISTRATIVO' },
		esAdmin: false,
	});
	assert.equal(r.status, 403);
	assert.equal(estado.asignado, null);
});

test('un no-admin NO puede quitar el rol ADMIN a otro usuario', async () => {
	const r = await ejecutar({
		body: { idRoles: [2], idRolPrincipal: 2 },
		actuales: [1],
		rol: { id: 4, nombre: 'ADMINISTRATIVO' },
		esAdmin: false,
	});
	assert.equal(r.status, 403);
});

test('el formato legacy (idRol) también valida la escalada', async () => {
	const r = await ejecutar({
		body: { idRol: 1 },
		actuales: [],
		rol: { id: 4, nombre: 'ADMINISTRATIVO' },
		esAdmin: false,
	});
	assert.equal(r.status, 403);
});

test('un admin de clínica NO puede otorgar SUPER_ADMIN', async () => {
	const r = await ejecutar({ body: { idRoles: [5], idRolPrincipal: 5 }, actuales: [] });
	assert.equal(r.status, 403);
	assert.equal(estado.asignado, null);
});

test('un super admin sí puede otorgar SUPER_ADMIN', async () => {
	const r = await ejecutar({
		body: { idRoles: [5], idRolPrincipal: 5 },
		rol: { id: 5, nombre: 'SUPER_ADMIN' },
		esAdmin: false,
	});
	assert.equal(r.status, 200);
});
