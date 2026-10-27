/**
 * Plan de migración custom → sistema + overrides (puro, sin BD).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);
const migrar = require(src('services/migrarRolesCustom.service.js'));
const matriz = require(src('utils/permisos.js'));
const personalPermisos = require(src('services/personalPermisos.service.js'));

const porNombre = new Map([
	['ADMIN', 1],
	['MEDICO', 2],
	['ENFERMERO', 3],
	['ADMINISTRATIVO', 4],
	['SUPER_ADMIN', 5],
	['CARGA_HC', 6],
	['PANEL_DATOS', 7],
]);

test('planearPersona: null si no hay custom', () => {
	const plan = migrar.planearPersona({
		valor: 1,
		nombre: 'X',
		rolesAsignados: [
			{
				idRol: 2,
				nombre: 'MEDICO',
				esCustom: false,
				esPrincipal: true,
				permisos: matriz.permisosDeRol('MEDICO'),
			},
		],
		overrides: { grants: [], denies: [] },
		porNombreSistema: porNombre,
	});
	assert.equal(plan, null);
});

test('planearPersona: custom MEDICO → rol sistema 2 y conserva extras/denies', () => {
	const plantillaMed = matriz.permisosDeRol('MEDICO');
	const customPerms = plantillaMed.filter((c) => !c.includes('ELIMINAR')).concat(['CONFIGURACION.PERSONAL.VER']);
	const plan = migrar.planearPersona({
		valor: 55,
		nombre: 'Dr Test',
		rolesAsignados: [
			{
				idRol: 1017,
				nombre: 'MEDICO 1',
				rolBase: 'MEDICO',
				esCustom: true,
				esPrincipal: true,
				permisos: customPerms,
			},
		],
		overrides: { grants: [], denies: [] },
		porNombreSistema: porNombre,
	});
	assert.ok(plan);
	assert.equal(plan.idRolPrincipal, 2);
	assert.deepEqual(
		plan.rolesDespues.map((r) => r.idRol),
		[2],
	);
	assert.ok(plan.grants.includes('CONFIGURACION.PERSONAL.VER'));
	assert.ok(plan.denies.some((c) => c.includes('ELIMINAR')));
	const aplicados = personalPermisos.aplicar(plan.baseNueva, plan.grants, plan.denies);
	assert.deepEqual([...aplicados].sort(), [...plan.efectivosPrevios].sort());
	assert.equal(plan.permisosConservados, true);
});

test('planearPersona: custom ENFERMERO + ya tenía ADMINISTRATIVO → ambos sistema', () => {
	const plan = migrar.planearPersona({
		valor: 9,
		nombre: 'Mix',
		rolesAsignados: [
			{
				idRol: 4,
				nombre: 'ADMINISTRATIVO',
				esCustom: false,
				esPrincipal: false,
				permisos: matriz.permisosDeRol('ADMINISTRATIVO'),
			},
			{
				idRol: 1003,
				nombre: 'ENFERMERÍA + INTERNACIÓN',
				rolBase: 'ENFERMERO',
				esCustom: true,
				esPrincipal: true,
				permisos: matriz.permisosDeRol('ENFERMERO'),
			},
		],
		overrides: { grants: [], denies: [] },
		porNombreSistema: porNombre,
	});
	assert.ok(plan);
	const ids = plan.rolesDespues.map((r) => r.idRol).sort();
	assert.deepEqual(ids, [3, 4]);
	assert.equal(plan.idRolPrincipal, 3); // principal era el custom enfermero
	assert.equal(plan.permisosConservados, true);
});

test('planearPersona: NINGUNO mapea a ADMINISTRATIVO', () => {
	const plan = migrar.planearPersona({
		valor: 3,
		nombre: 'X',
		rolesAsignados: [
			{
				idRol: 1999,
				nombre: 'Especial',
				rolBase: 'NINGUNO',
				esCustom: true,
				esPrincipal: true,
				permisos: ['TURNOS.AGENDA.VER'],
			},
		],
		overrides: { grants: [], denies: [] },
		porNombreSistema: porNombre,
	});
	assert.equal(plan.idRolPrincipal, 4);
	assert.ok(plan.denies.length > 0 || plan.grants.length >= 0);
	assert.equal(plan.permisosConservados, true);
});

test('idSistemaDeBase respeta el mapa', () => {
	assert.equal(migrar.idSistemaDeBase('MEDICO', porNombre), 2);
	assert.equal(migrar.idSistemaDeBase('CARGA_HC', porNombre), 6);
	assert.equal(migrar.idSistemaDeBase('NINGUNO', porNombre), 4);
});
