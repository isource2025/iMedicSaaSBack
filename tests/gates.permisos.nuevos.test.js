/**
 * Regresión: permisos nuevos de la migración rol→código existen en catálogo
 * y están en las plantillas esperadas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const matriz = require('../src/utils/permisos');
const { reqTienePermiso } = require('../src/middlewares/requirePermiso.middleware');
const { esAdminClinico } = require('../src/middlewares/propietario.middleware');
const { puedeUsarSql } = require('../src/asistente/sql');

const NUEVOS = [
	'INTERNACION.REGISTROS.EDITAR_AJENOS',
	'TURNOS.AGENDA.CERRAR',
	'TURNOS.AGENDA.SOLO_PROPIA',
	'TURNOS.AGENDA.GESTIONAR',
	'TURNOS.CONVERSACIONES.VER',
	'INTERNACION.INDICACIONES.MARCAR_VISTO',
	'INTERNACION.ESTUDIOS.VER_TODOS',
	'INTERNACION.INTERCONSULTAS.VER_TODOS',
	'ASISTENTE.SQL.VER',
	'CONFIGURACION.OPCGRD.VER',
];

test('los permisos nuevos están en el catálogo', () => {
	const cat = new Set(matriz.todosLosCodigos().map((c) => c.codigo));
	for (const c of NUEVOS) assert.ok(cat.has(c), `falta ${c}`);
});

test('ADMIN tiene EDITAR_AJENOS, VER_TODOS y OPCGRD; MEDICO tiene SOLO_PROPIA y SQL', () => {
	const admin = new Set(matriz.permisosDeRol('ADMIN'));
	const med = new Set(matriz.permisosDeRol('MEDICO'));
	const enf = new Set(matriz.permisosDeRol('ENFERMERO'));
	const adm = new Set(matriz.permisosDeRol('ADMINISTRATIVO'));

	assert.ok(admin.has('INTERNACION.REGISTROS.EDITAR_AJENOS'));
	assert.ok(admin.has('INTERNACION.ESTUDIOS.VER_TODOS'));
	assert.ok(admin.has('CONFIGURACION.OPCGRD.VER'));
	assert.ok(admin.has('TURNOS.CONVERSACIONES.VER'));

	assert.ok(med.has('TURNOS.AGENDA.SOLO_PROPIA'));
	assert.ok(med.has('TURNOS.AGENDA.CERRAR'));
	assert.ok(med.has('ASISTENTE.SQL.VER'));
	assert.ok(!med.has('TURNOS.CONVERSACIONES.VER'));
	assert.ok(!med.has('INTERNACION.ESTUDIOS.VER_TODOS'));

	assert.ok(enf.has('INTERNACION.INDICACIONES.MARCAR_VISTO'));
	assert.ok(!enf.has('TURNOS.AGENDA.CERRAR'));

	assert.ok(adm.has('TURNOS.AGENDA.CERRAR'));
	assert.ok(adm.has('TURNOS.AGENDA.GESTIONAR'));
	assert.ok(adm.has('TURNOS.CONVERSACIONES.VER'));
});

test('reqTienePermiso usa req.permisos cacheado', async () => {
	const req = { permisos: ['INTERNACION.REGISTROS.EDITAR_AJENOS'] };
	assert.equal(await reqTienePermiso(req, 'INTERNACION.REGISTROS.EDITAR_AJENOS'), true);
	assert.equal(await reqTienePermiso(req, 'TURNOS.AGENDA.CERRAR'), false);
});

test('esAdminClinico delega al permiso EDITAR_AJENOS', async () => {
	assert.equal(
		await esAdminClinico({ permisos: ['INTERNACION.REGISTROS.EDITAR_AJENOS'] }),
		true,
	);
	assert.equal(await esAdminClinico({ permisos: ['INTERNACION.CAMAS.VER'] }), false);
});

test('puedeUsarSql exige ASISTENTE.SQL.VER (sin allowlist de roles por defecto)', () => {
	assert.equal(puedeUsarSql('ADMIN', []), false);
	assert.equal(puedeUsarSql('MEDICO', ['ASISTENTE.SQL.VER']), true);
	assert.equal(puedeUsarSql('ENFERMERO', ['ASISTENTE.SQL.VER']), true);
});
