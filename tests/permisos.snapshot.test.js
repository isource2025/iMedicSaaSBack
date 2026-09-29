/**
 * Instantánea de la matriz de permisos.
 *
 * Objetivo: que cualquier cambio en los permisos de los roles estándar (o en el
 * catálogo) sea DELIBERADO. Si este test falla, se cambió la matriz: revisar el
 * cambio y, si es intencional, regenerar la instantánea con:
 *
 *   node tests/permisos.snapshot.test.js --actualizar
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const matriz = require('../src/utils/permisos');

const FIXTURE = path.join(__dirname, 'fixtures', 'permisos.snapshot.json');

function construir() {
	const plantillas = {};
	for (const rol of Object.keys(matriz.PLANTILLAS).sort()) {
		plantillas[rol] = [...matriz.PLANTILLAS[rol]].sort();
	}
	return { catalogo: matriz.todosLosCodigos().map((c) => c.codigo).sort(), plantillas };
}

if (process.argv.includes('--actualizar')) {
	fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
	fs.writeFileSync(FIXTURE, JSON.stringify(construir(), null, '\t') + '\n');
	console.log('Instantánea de permisos actualizada.');
	process.exit(0);
}

const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const actual = construir();

test('el catálogo de permisos no cambió sin querer', () => {
	assert.deepEqual(actual.catalogo, esperado.catalogo);
});

for (const rol of Object.keys(esperado.plantillas)) {
	test(`la plantilla ${rol} no cambió sin querer`, () => {
		assert.deepEqual(actual.plantillas[rol], esperado.plantillas[rol]);
	});
}

test('no aparecieron roles estándar nuevos sin registrar', () => {
	assert.deepEqual(Object.keys(actual.plantillas).sort(), Object.keys(esperado.plantillas).sort());
});

test('todo permiso de una plantilla existe en el catálogo', () => {
	const cat = new Set(actual.catalogo);
	for (const [rol, lista] of Object.entries(actual.plantillas)) {
		for (const c of lista) assert.ok(cat.has(c), `${rol} usa '${c}', que no existe en el catálogo`);
	}
});

test('el rol ENFERMERO puede trasladar pero no dar egresos', () => {
	const e = new Set(actual.plantillas.ENFERMERO);
	assert.ok(e.has('INTERNACION.MOVIMIENTOS.TRASLADAR'));
	assert.ok(!e.has('INTERNACION.MOVIMIENTOS.GESTIONAR'));
});
