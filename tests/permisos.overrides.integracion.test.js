/**
 * permisosDeUsuario aplica GRANT/DENY sobre la unión de roles.
 * Auth central + personalPermisos mockeados (sin BD).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const rolesMock = [
	{ idRol: 2, nombre: 'MEDICO', nivel: 50, EsPrincipal: true, esPrincipal: true },
];

const authPath = require.resolve(src('services/authCentral.service.js'));
require.cache[authPath] = {
	id: authPath,
	filename: authPath,
	loaded: true,
	exports: {
		isAuthCentralEnabled: () => true,
		listarRolesDeValorPersonal: async () => rolesMock,
		permisosDeRol: async () => [],
	},
};

const tenantPath = require.resolve(src('context/tenantContext.js'));
require.cache[tenantPath] = {
	id: tenantPath,
	filename: tenantPath,
	loaded: true,
	exports: {
		getTenantId: () => 103,
		runWithTenant: (_id, fn) => fn(),
	},
};

let overrides = { grants: [], denies: [] };
const ovPath = require.resolve(src('services/personalPermisos.service.js'));
const ovReal = require(src('services/personalPermisos.service.js'));
require.cache[ovPath] = {
	id: ovPath,
	filename: ovPath,
	loaded: true,
	exports: {
		...ovReal,
		listarOverrides: async () => ({ ...overrides, grants: [...overrides.grants], denies: [...overrides.denies] }),
	},
};

// Re-require permisos.service with mocks in place
delete require.cache[require.resolve(src('services/permisos.service.js'))];
const permisosService = require(src('services/permisos.service.js'));
const matriz = require(src('utils/permisos.js'));

test('sin overrides: efectivos = plantilla del rol', async () => {
	overrides = { grants: [], denies: [] };
	const r = await permisosService.permisosDeUsuario(123);
	assert.equal(r.rol.nombre, 'MEDICO');
	const plantilla = new Set(matriz.permisosDeRol('MEDICO'));
	assert.equal(r.permisos.length, plantilla.size);
	assert.ok(r.permisos.every((c) => plantilla.has(c)));
	assert.deepEqual(r.grants, []);
	assert.deepEqual(r.denies, []);
});

test('GRANT agrega un permiso que el rol no tiene', async () => {
	const extra = 'CONFIGURACION.PERSONAL.VER';
	assert.ok(!matriz.permisosDeRol('MEDICO').includes(extra));
	overrides = { grants: [extra], denies: [] };
	const r = await permisosService.permisosDeUsuario(123);
	assert.ok(r.permisos.includes(extra));
	assert.ok(r.base.every((c) => c !== extra));
	assert.deepEqual(r.grants, [extra]);
});

test('DENY quita un permiso de la plantilla', async () => {
	const plantilla = matriz.permisosDeRol('MEDICO');
	const quitado = plantilla.find((c) => c.endsWith('.VER')) || plantilla[0];
	overrides = { grants: [], denies: [quitado] };
	const r = await permisosService.permisosDeUsuario(123);
	assert.ok(r.base.includes(quitado));
	assert.ok(!r.permisos.includes(quitado));
	assert.deepEqual(r.denies, [quitado]);
});

test('si listarOverrides falla, quedan sólo los roles (no se cae)', async () => {
	require.cache[ovPath].exports.listarOverrides = async () => {
		throw new Error('boom simulado');
	};
	delete require.cache[require.resolve(src('services/permisos.service.js'))];
	const svc2 = require(src('services/permisos.service.js'));
	const r = await svc2.permisosDeUsuario(123);
	assert.ok(r.permisos.length > 0);
	assert.deepEqual(r.grants, []);
	assert.deepEqual(r.denies, []);
});
