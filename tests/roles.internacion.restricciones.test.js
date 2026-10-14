/**
 * Reglas fijas de Internación, válidas para todas las empresas:
 *   - ENFERMERO no crea, edita ni elimina indicaciones médicas (solo las ve y aplica).
 *   - ADMINISTRATIVO solo tiene permisos VER en todo el módulo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const matriz = require('../src/utils/permisos');

test('ENFERMERO no puede crear, editar ni eliminar indicaciones', () => {
	const permisos = matriz.permisosDeRol('ENFERMERO');
	for (const accion of ['CREAR', 'EDITAR', 'ELIMINAR']) {
		assert.ok(!permisos.includes(`INTERNACION.INDICACIONES.${accion}`), accion);
	}
	assert.ok(permisos.includes('INTERNACION.INDICACIONES.VER'));
	assert.ok(permisos.includes('INTERNACION.INDICACIONES.APLICAR'));
});

test('ADMINISTRATIVO solo tiene permisos VER en Internación', () => {
	const internacion = matriz.permisosDeRol('ADMINISTRATIVO').filter((c) => c.startsWith('INTERNACION.'));
	assert.ok(internacion.length > 0);
	assert.deepEqual(internacion.filter((c) => !c.endsWith('.VER')), []);
});
