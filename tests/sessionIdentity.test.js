const test = require('node:test');
const assert = require('node:assert/strict');
const {
	resolveCodOperador,
	requireOperadorCarga,
	quitarAutorDelBody,
	firmarSesion,
} = require('../src/utils/sessionIdentity');

test('CodOperador sale del JWT de sesión, no de un default ni de 0', () => {
	assert.equal(
		resolveCodOperador({ auth: { usuario: { codOperador: 99 } } }),
		99,
	);
	assert.equal(
		resolveCodOperador({ auth: { usuario: { CodOperador: 0 } } }),
		null,
	);
	assert.equal(resolveCodOperador({ auth: { usuario: {} } }), null);
});

test('el JWT gana sobre req.codOperador (el body no puede firmar por otro)', () => {
	assert.equal(
		resolveCodOperador({
			codOperador: 25,
			auth: { usuario: { codOperador: 99 } },
		}),
		99,
	);
});

test('requireOperadorCarga rechaza sesión sin operador', () => {
	const res = {
		statusCode: null,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(payload) {
			this.body = payload;
			return this;
		},
	};
	assert.equal(requireOperadorCarga({ auth: { usuario: {} } }, res), null);
	assert.equal(res.statusCode, 400);
	assert.match(String(res.body?.mensaje || ''), /CodOperador/);
});

test('quitarAutorDelBody ignora EMERGENCIAS / ids del cliente y deja el equipo', () => {
	const data = {
		Evolucion: 'ok',
		Profecional: 25,
		OperadorCarga: 'EMERGENCIAS',
		codOperador: 25,
		idOperador: 25,
		matriculaSolicitante: 25,
		profesionales: [{ valorPersonal: 10 }],
	};
	quitarAutorDelBody(data);
	assert.equal(data.Evolucion, 'ok');
	assert.equal(data.Profecional, undefined);
	assert.equal(data.OperadorCarga, undefined);
	assert.equal(data.codOperador, undefined);
	assert.equal(data.idOperador, undefined);
	assert.equal(data.matriculaSolicitante, undefined);
	assert.equal(data.profesionales[0].valorPersonal, 10);
});

test('los controllers clínicos no toman el autor del body', () => {
	const fs = require('fs');
	const path = require('path');
	const dir = path.join(__dirname, '../src/controllers');
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
		const t = fs.readFileSync(path.join(dir, f), 'utf8');
		assert.equal(
			t.includes('Number(body.matriculaSolicitante)'),
			false,
			`${f} no puede firmar con matriculaSolicitante del body`,
		);
		assert.equal(
			t.includes('Number(body.matriculaRealizador)'),
			false,
			`${f} no puede firmar con matriculaRealizador del body`,
		);
		if (f === 'protocolos.controller.js') {
			assert.equal(t.includes('body.idOperador'), false, `${f} no puede usar idOperador del body`);
		}
	}
});

test('firmarSesion usa JWT y no el body', () => {
	const res = {
		statusCode: null,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(payload) {
			this.body = payload;
			return this;
		},
	};
	const req = {
		codOperador: 25,
		auth: { usuario: { codOperador: 99, id: 29, matricula: 8625 } },
		matricula: 8625,
	};
	const sesion = firmarSesion(req, res);
	assert.equal(sesion.codOperador, 99);
	assert.equal(sesion.valorPersonal, 29);
	assert.equal(sesion.matricula, 8625);
});
