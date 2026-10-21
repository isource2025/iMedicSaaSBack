'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	matriculaAlcanceAgenda,
	puedeConfigurarAgendaTerceros,
} = require('../src/utils/matriculaTenant');

function mockRes() {
	const res = {
		statusCode: null,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(body) {
			this.body = body;
			return this;
		},
	};
	return res;
}

test('puedeConfigurarAgendaTerceros detecta CONFIGURACION y EXCEPCIONES', () => {
	assert.equal(puedeConfigurarAgendaTerceros(['TURNOS.CONFIGURACION.EDITAR']), true);
	assert.equal(puedeConfigurarAgendaTerceros(['TURNOS.EXCEPCIONES.VER']), true);
	assert.equal(puedeConfigurarAgendaTerceros(['TURNOS.AGENDA.VER']), false);
	assert.equal(puedeConfigurarAgendaTerceros([]), false);
});

test('MEDICO con CONFIGURACION usa matrícula del path (no la del actor)', async () => {
	const res = mockRes();
	const req = {
		rolNombre: 'MEDICO',
		matricula: null,
		valorPersonal: 1,
		permisos: ['TURNOS.CONFIGURACION.EDITAR', 'TURNOS.CONFIGURACION.VER'],
	};
	const m = await matriculaAlcanceAgenda(req, res, '999');
	assert.equal(m, 999);
	assert.equal(res.statusCode, null);
});

test('MEDICO sin permiso de config y sin matrícula → 403', async () => {
	const res = mockRes();
	const req = {
		rolNombre: 'MEDICO',
		matricula: null,
		valorPersonal: null,
		permisos: ['TURNOS.AGENDA.VER'],
	};
	const m = await matriculaAlcanceAgenda(req, res, '999');
	assert.equal(m, null);
	assert.equal(res.statusCode, 403);
	assert.match(String(res.body?.mensaje || ''), /matrícula asignada/i);
});

test('ADMIN usa matrícula del path', async () => {
	const res = mockRes();
	const req = {
		rolNombre: 'ADMIN',
		permisos: ['TURNOS.CONFIGURACION.EDITAR'],
	};
	const m = await matriculaAlcanceAgenda(req, res, '103');
	assert.equal(m, 103);
});

test('path inválido → 400', async () => {
	const res = mockRes();
	const req = { rolNombre: 'ADMIN', permisos: [] };
	const m = await matriculaAlcanceAgenda(req, res, '0');
	assert.equal(m, null);
	assert.equal(res.statusCode, 400);
});
