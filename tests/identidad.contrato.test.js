/**
 * Contrato de identidad: cada columna recibe su clave y no se sustituye una por otra.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
	claveDe,
	firma,
	ordenDeLectura,
	COLUMNAS,
	OPERADOR,
	FICHA,
	MATRICULA,
} = require('../src/identidad/contrato');

const sesion = (usuario) => ({ auth: { usuario } });

test('el contrato cubre las columnas de autor medidas', () => {
	assert.equal(claveDe('imRendiciones.OperGraba'), OPERADOR);
	assert.equal(claveDe('HCProtocolosPtes.IdOperador'), OPERADOR);
	assert.equal(claveDe('imInterCtrlFrecuente.Profesional'), FICHA);
	assert.equal(claveDe('imHCEvolucion.Profecional'), FICHA);
	assert.equal(claveDe('imVisita.DOCTORADMISOR'), FICHA);
	assert.equal(claveDe('imHCI.IdProfecional'), OPERADOR);
	assert.equal(claveDe('imFacProfesionales.Matricula'), FICHA);
	assert.equal(claveDe('imPedidosEstudios.ValorProfesional'), FICHA);
	assert.equal(claveDe('imTurnos.Profesional'), MATRICULA);
	assert.ok(Object.keys(COLUMNAS).length >= 40);
});

test('firma.para entrega la clave de la columna, sin sustituir', () => {
	const f = firma(sesion({ codOperador: 30, id: 29, matricula: 6831 }));
	assert.equal(f.para('imInterCtrlFrecuente.OperadorCarga'), 30);
	assert.equal(f.para('imInterCtrlFrecuente.Profesional'), 29);
	assert.equal(f.para('imTurnos.Profesional'), 6831);
});

test('firma.para no usa otra clave si falta la de la columna', () => {
	const f = firma(sesion({ codOperador: 30, matricula: 6831 }));
	assert.throws(() => f.para('imInterCtrlFrecuente.Profesional'), (e) => e.statusCode === 400);
	const f2 = firma(sesion({ id: 29, matricula: 6831 }));
	assert.throws(() => f2.para('imRendiciones.OperGraba'), (e) => e.statusCode === 400);
});

test('cada columna se lee primero por su clave de contrato', () => {
	assert.equal(ordenDeLectura('imRendiciones.OperGraba')[0], 'operador');
	assert.equal(ordenDeLectura('imVisita.DOCTORADMISOR')[0], 'valor');
	assert.equal(ordenDeLectura('imHCEvolucion.Profecional')[0], 'valor');
	assert.equal(ordenDeLectura('imHCI.IdProfecional')[0], 'operador');
	assert.equal(ordenDeLectura('imPedidosEstudios.ValorProfesional')[0], 'valor');
	assert.equal(ordenDeLectura('imTurnos.Profesional')[0], 'matricula');
});
