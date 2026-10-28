const test = require('node:test');
const assert = require('node:assert/strict');
const cuota = require('../src/asistente/cuota');

function reqDe(extra) {
	return { idEmpresa: 1, valorPersonal: 10, ...extra };
}

function conEnv(valor, fn) {
	const prev = process.env.ASISTENTE_CUOTA_MENSAJES;
	if (valor === undefined) delete process.env.ASISTENTE_CUOTA_MENSAJES;
	else process.env.ASISTENTE_CUOTA_MENSAJES = valor;
	return Promise.resolve()
		.then(fn)
		.finally(() => {
			if (prev == null) delete process.env.ASISTENTE_CUOTA_MENSAJES;
			else process.env.ASISTENTE_CUOTA_MENSAJES = prev;
			cuota._reiniciarMemoria();
			cuota._setContarMensajes(null);
		});
}

test('tope de prueba: 5 por defecto, 0 desactiva, env inválido vuelve a 5', async () => {
	await conEnv(undefined, () => assert.equal(cuota.limiteActual(), 5));
	await conEnv('0', () => assert.equal(cuota.limiteActual(), 0));
	await conEnv('5', () => assert.equal(cuota.limiteActual(), 5));
	await conEnv('no', () => assert.equal(cuota.limiteActual(), 5));
});

test('estadoDesde marca limitada al llegar al tope', () => {
	assert.deepEqual(cuota.estadoDesde(0, 5), {
		limite: 5,
		usados: 0,
		restantes: 5,
		limitada: false,
		prueba: true,
	});
	assert.equal(cuota.estadoDesde(5, 5).limitada, true);
	assert.equal(cuota.estadoDesde(5, 5).restantes, 0);
	assert.equal(cuota.estadoDesde(2, 0).prueba, false);
	assert.equal(cuota.estadoDesde(2, 0).limitada, false);
});

test('exigir bloquea el sexto mensaje y consumir cuenta en memoria', async () => {
	await conEnv('5', async () => {
		cuota._setContarMensajes(async () => 0);
		const req = reqDe();
		for (let i = 0; i < 5; i++) {
			const e = await cuota.exigir(req);
			assert.equal(e.limitada, false);
			cuota.consumir(req);
		}
		await assert.rejects(() => cuota.exigir(req), (err) => {
			assert.equal(err.statusCode, 429);
			assert.match(err.message, /límite de 5 mensajes/);
			assert.equal(err.cuota.limitada, true);
			return true;
		});
	});
});

test('la cuota en base cuenta aunque la memoria esté vacía', async () => {
	await conEnv('5', async () => {
		cuota._setContarMensajes(async () => 5);
		const e = await cuota.estadoDe(reqDe());
		assert.equal(e.usados, 5);
		assert.equal(e.limitada, true);
	});
});
