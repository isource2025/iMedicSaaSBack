/**
 * Baranda: la web no puede volver a grabar CodOperador || ValorPersonal
 * ni tomar el autor del body en las rutas clínicas cubiertas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) walk(p, acc);
		else if (p.endsWith('.js')) acc.push(p);
	}
	return acc;
}

const src = path.join(__dirname, '..', 'src');
const controllers = walk(path.join(src, 'controllers'));

test('controllers no sustituyen CodOperador por ValorPersonal', () => {
	const hits = [];
	for (const f of controllers) {
		const t = fs.readFileSync(f, 'utf8');
		if (/_codOperadorSesion\(req\)\s*\|\|\s*Number\(req\.valorPersonal\)/.test(t)) {
			hits.push(path.relative(src, f));
		}
	}
	assert.deepEqual(hits, []);
});

test('protocolos no toma IdOperador del body', () => {
	const t = fs.readFileSync(path.join(src, 'controllers', 'protocolos.controller.js'), 'utf8');
	assert.equal(/body\.idOperador/.test(t), false);
	assert.equal(/firmarORechazar/.test(t), true);
});

test('controles frecuentes no copian OperadorCarga en Profesional', () => {
	const t = fs.readFileSync(path.join(src, 'services', 'controlesFrecuentes.service.js'), 'utf8');
	assert.equal(/data\.operadorCarga \|\| 0 \},?\s+\/\/ @param4/.test(t), false);
	assert.equal(/data\.profesional/.test(t), true);
});

test('indicaciones une ProfesionalAsiste con sqlApplyFicha (alias prof)', () => {
	const t = fs.readFileSync(path.join(src, 'services', 'indicaciones.service.js'), 'utf8');
	assert.match(t, /sqlApplyFicha\(\s*'iim\.ProfesionalAsiste'\s*,\s*'prof'\s*\)/);
	assert.match(t, /SQL_NOMBRE_PROFESIONAL = 'prof\.NombreCompleto'/);
});
