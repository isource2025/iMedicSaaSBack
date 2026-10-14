/**
 * Reglas fijas de Internación, válidas para todas las empresas:
 *   - ENFERMERO no crea, edita ni elimina indicaciones médicas (solo las ve y aplica).
 *   - ADMINISTRATIVO solo ve lo clínico; su única escritura es camas, movimientos
 *     (traslados y egresos) y exportar la tabla.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const matriz = require('../src/utils/permisos');

const ESCRITURA_ADMINISTRATIVO = [
	'INTERNACION.CAMAS.CREAR',
	'INTERNACION.CAMAS.EDITAR',
	'INTERNACION.CAMAS.ELIMINAR',
	'INTERNACION.CAMAS.GESTIONAR',
	'INTERNACION.MOVIMIENTOS.TRASLADAR',
	'INTERNACION.MOVIMIENTOS.GESTIONAR',
	'INTERNACION.TABLA.EXPORTAR',
];

test('ENFERMERO no puede crear, editar ni eliminar indicaciones', () => {
	const permisos = matriz.permisosDeRol('ENFERMERO');
	for (const accion of ['CREAR', 'EDITAR', 'ELIMINAR']) {
		assert.ok(!permisos.includes(`INTERNACION.INDICACIONES.${accion}`), accion);
	}
	assert.ok(permisos.includes('INTERNACION.INDICACIONES.VER'));
	assert.ok(permisos.includes('INTERNACION.INDICACIONES.APLICAR'));
});

test('ADMINISTRATIVO solo escribe camas, movimientos y export en Internación', () => {
	const internacion = matriz.permisosDeRol('ADMINISTRATIVO').filter((c) => c.startsWith('INTERNACION.'));
	const escritura = internacion.filter((c) => !c.endsWith('.VER')).sort();
	assert.deepEqual(escritura, [...ESCRITURA_ADMINISTRATIVO].sort());
});
