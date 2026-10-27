/**
 * El egreso debe firmar con el CodOperador de la sesión.
 * No se conserva el operador de internación (p. ej. EMERGENCIAS).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const servicioSrc = fs.readFileSync(
	path.join(__dirname, '..', 'src', 'services', 'visitaMovimientos.service.js'),
	'utf8',
);

test('el UPDATE de egreso pisa Operador y OperadorEgreso con @op de sesión', () => {
	const start = servicioSrc.indexOf('async function actualizarUltimoMovimientoVisita');
	const end = servicioSrc.indexOf('async function resolverContextoRevertirEgreso');
	assert.ok(start >= 0 && end > start);
	const fn = servicioSrc.slice(start, end);
	assert.match(fn, /Operador = @op/);
	assert.match(fn, /OperadorEgreso = @op/);
	assert.equal(fn.includes('ELSE m.Operador'), false);
	assert.equal(fn.includes('datosEgreso.operadorEgreso'), false);
});

test('el listado de un egreso prefiere OperadorEgreso al operador de internación', () => {
	const start = servicioSrc.indexOf('async function queryMovimientosPorNumero');
	const end = servicioSrc.indexOf('async function queryMovimientoInicialDesdeCabecera');
	assert.ok(start >= 0 && end > start);
	const fn = servicioSrc.slice(start, end);
	const idxEgr = fn.indexOf('v.OperadorEgreso');
	const idxMov = fn.indexOf('CAST(m.Operador AS varchar(40))');
	assert.ok(idxEgr >= 0, 'usa OperadorEgreso');
	assert.ok(idxMov >= 0, 'tiene fallback a m.Operador');
	assert.ok(idxEgr < idxMov, 'OperadorEgreso va antes que el operador de internación');
});
