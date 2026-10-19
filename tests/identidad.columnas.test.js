/**
 * CodOperador y ValorPersonal son claves independientes: cada columna de autor recibe la suya
 * (OperadorCarga ← CodOperador, Profesional ← imPersonal.Valor) y al leer manda esa clave.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { firmarSesion, resolveProfesional } = require('../src/utils/sessionIdentity');
const { sqlApplyOperador, sqlApplyFicha } = require('../src/utils/sqlNombrePersona');

const sesion = (usuario) => ({ auth: { usuario } });
const resStub = () => ({ status: () => ({ json: () => {} }) });

test('firmarSesion entrega CodOperador y ficha por separado', () => {
	const firma = firmarSesion(sesion({ codOperador: 30, id: 29, matricula: 6831 }), resStub());
	assert.deepEqual(firma, { codOperador: 30, valorPersonal: 29, matricula: 6831 });
});

test('sin ficha, Profesional queda en 0 y no toma el CodOperador', () => {
	const firma = firmarSesion(sesion({ codOperador: 30 }), resStub());
	assert.equal(firma.valorPersonal, 0);
});

test('el profesional es la ficha aunque la sesión tenga matrícula', () => {
	assert.equal(resolveProfesional(sesion({ codOperador: 30, id: 29, matricula: 6831 })), 29);
});

const prioDe = (sql, condicion) => {
	const rama = sql.split('UNION ALL').find((r) => r.includes(condicion));
	return Number(/(\d+) AS Prio/.exec(rama)[1]);
};

test('OperadorCarga se lee primero como CodOperador', () => {
	const sql = sqlApplyOperador('x.OperadorCarga', 'op');
	assert.equal(prioDe(sql, 'pw0.CodOperador'), 0);
	assert.ok(prioDe(sql, 'per0.Valor =') > 0);
});

test('Profesional se lee primero como imPersonal.Valor', () => {
	const sql = sqlApplyFicha('x.Profesional', 'prof');
	assert.equal(prioDe(sql, 'per0.Valor ='), 0);
	assert.ok(prioDe(sql, 'per1.Matricula') > 0);
	assert.ok(prioDe(sql, 'pw0.CodOperador') > 0);
});
