/** Autenticación del bridge PACS (sin SQL: los pedidos autorizados fallan después, con 500). */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { signRequest, HEADER } = require('../src/utils/signedFileToken');

const KEY = 'b'.repeat(64);

function puertoLibre() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

async function levantar(env) {
	const port = await puertoLibre();
	const child = spawn(process.execPath, [path.join(__dirname, '..', 'pacs-bridge.js')], {
		env: { ...process.env, IMEDIC_PACS_PORT: String(port), IMEDIC_PACS_SQL_USER: '', ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	await new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('pacs-bridge no arrancó')), 10000);
		child.stdout.on('data', (d) => {
			if (String(d).includes('auth:')) {
				clearTimeout(t);
				resolve();
			}
		});
		child.on('exit', (code) => reject(new Error(`pacs-bridge salió con ${code}`)));
	});
	return { base: `http://127.0.0.1:${port}`, cerrar: () => child.kill() };
}

test('bridge PACS con clave de firma', async (t) => {
	const srv = await levantar({ IMEDIC_PACS_SIGNING_KEY: KEY, IMEDIC_PACS_EMPRESA_ID: '101', IMEDIC_PACS_TOKEN: '' });
	t.after(() => srv.cerrar());
	const ruta = '/studies?patientId=30123456';

	const anon = await fetch(`${srv.base}${ruta}`, { headers: { Origin: 'https://malo.test' } });
	assert.strictEqual(anon.status, 401);
	assert.strictEqual(anon.headers.get('access-control-allow-origin'), null);

	const otra = signRequest({ key: KEY, idEmpresa: 101, method: 'GET', url: '/studies?patientId=1' });
	assert.strictEqual((await fetch(`${srv.base}${ruta}`, { headers: { [HEADER]: otra } })).status, 401);

	const ok = signRequest({ key: KEY, idEmpresa: 101, method: 'GET', url: ruta });
	assert.notStrictEqual((await fetch(`${srv.base}${ruta}`, { headers: { [HEADER]: ok } })).status, 401);

	const health = await (await fetch(`${srv.base}/health`)).json();
	assert.strictEqual(health.security, 'v1');
	assert.strictEqual(health.signing, true);
	assert.strictEqual(health.fsRoot, undefined);
	assert.strictEqual(health.sqlServer, undefined);
});

test('bridge PACS sin credenciales: 503', async (t) => {
	const srv = await levantar({ IMEDIC_PACS_SIGNING_KEY: '', IMEDIC_PACS_TOKEN: '' });
	t.after(() => srv.cerrar());
	assert.strictEqual((await fetch(`${srv.base}/studies?patientId=1`)).status, 503);
});
