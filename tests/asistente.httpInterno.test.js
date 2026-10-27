const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const httpInterno = require('../src/asistente/httpInterno');

test('httpInterno despacha GET/POST contra una app Express', async () => {
	const app = express();
	app.use(express.json());
	app.get('/api/ping', (req, res) => {
		res.json({ ok: true, q: req.query.x || null });
	});
	app.post('/api/echo', (req, res) => {
		res.status(201).json({ body: req.body, auth: req.headers.authorization || null });
	});
	httpInterno.bindApp(app);

	const get = await httpInterno.llamar({ method: 'GET', path: '/api/ping', query: { x: '1' } });
	assert.equal(get.status, 200);
	assert.equal(get.body.ok, true);
	assert.equal(get.body.q, '1');

	const post = await httpInterno.llamar({
		method: 'POST',
		path: '/api/echo',
		body: { hola: 'mundo' },
		headers: { authorization: 'Bearer demo' },
	});
	assert.equal(post.status, 201);
	assert.deepEqual(post.body.body, { hola: 'mundo' });
	assert.equal(post.body.auth, 'Bearer demo');
	httpInterno.cerrarServer();
});
