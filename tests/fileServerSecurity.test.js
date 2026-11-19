/**
 * Levanta file-server.js de verdad (carpeta temporal, puerto libre) y prueba
 * autenticación, confinamiento a la carpeta y ausencia de CORS.
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { signRequest, HEADER } = require('../src/utils/signedFileToken');

const KEY = 'a'.repeat(64);
const LEGACY = 'token-legado-de-prueba';

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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-sec-'));
	const root = path.join(dir, 'adjuntos');
	fs.mkdirSync(path.join(root, '1 PEREZ'), { recursive: true });
	fs.writeFileSync(path.join(root, '1 PEREZ', 'a.pdf'), 'PDF-OK');
	fs.writeFileSync(path.join(dir, 'secreto.txt'), 'NO');
	const child = spawn(process.execPath, [path.join(__dirname, '..', 'file-server.js')], {
		cwd: dir,
		env: { ...process.env, IMEDIC_FS_PORT: String(port), IMEDIC_FS_ROOT: root, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	await new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('file-server no arrancó')), 10000);
		child.stdout.on('data', (d) => {
			if (String(d).includes('escuchando')) {
				clearTimeout(t);
				resolve();
			}
		});
		child.on('exit', (code) => reject(new Error(`file-server salió con ${code}`)));
	});
	const base = `http://127.0.0.1:${port}`;
	return {
		base,
		root,
		dir,
		cerrar() {
			child.kill();
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

function q(p) {
	return `/file?path=${encodeURIComponent(encodeURIComponent(p))}`;
}

async function pedir(srv, ruta, { firmar = false, headers = {}, method = 'GET', body } = {}) {
	const h = { ...headers };
	if (firmar) h[HEADER] = signRequest({ key: KEY, idEmpresa: 101, method, url: ruta });
	const r = await fetch(`${srv.base}${ruta}`, { method, headers: h, body });
	return { status: r.status, headers: r.headers, text: await r.text() };
}

test('file server con clave de firma', async (t) => {
	const srv = await levantar({
		IMEDIC_FS_SIGNING_KEY: KEY,
		IMEDIC_FS_EMPRESA_ID: '101',
		IMEDIC_FS_TOKEN: LEGACY,
	});
	t.after(() => srv.cerrar());
	const archivo = path.join(srv.root, '1 PEREZ', 'a.pdf');

	await t.test('health público sin rutas del disco y sin CORS', async () => {
		const r = await pedir(srv, '/health', { headers: { Origin: 'https://malo.test' } });
		assert.strictEqual(r.status, 200);
		const body = JSON.parse(r.text);
		assert.strictEqual(body.security, 'v1');
		assert.strictEqual(body.auth, 'firma+token-legado');
		assert.strictEqual(body.root, undefined);
		assert.strictEqual(r.headers.get('access-control-allow-origin'), null);
	});

	await t.test('sin credencial: 401', async () => {
		assert.strictEqual((await pedir(srv, q(archivo))).status, 401);
	});

	await t.test('firma válida: 200', async () => {
		const r = await pedir(srv, q(archivo), { firmar: true });
		assert.strictEqual(r.status, 200);
		assert.strictEqual(r.text, 'PDF-OK');
	});

	await t.test('firma de otro archivo no sirve', async () => {
		const sig = signRequest({ key: KEY, idEmpresa: 101, method: 'GET', url: q('otro.pdf') });
		assert.strictEqual((await pedir(srv, q(archivo), { headers: { [HEADER]: sig } })).status, 401);
	});

	await t.test('firma de otra empresa no sirve', async () => {
		const sig = signRequest({ key: KEY, idEmpresa: 102, method: 'GET', url: q(archivo) });
		assert.strictEqual((await pedir(srv, q(archivo), { headers: { [HEADER]: sig } })).status, 401);
	});

	await t.test('firma por ?sig= en la URL', async () => {
		const sig = signRequest({ key: KEY, idEmpresa: 101, method: 'GET', url: q(archivo) });
		const r = await pedir(srv, `${q(archivo)}&sig=${encodeURIComponent(sig)}`);
		assert.strictEqual(r.status, 200);
	});

	await t.test('token legado sigue funcionando (transición)', async () => {
		const r = await pedir(srv, q(archivo), { headers: { 'x-imedic-token': LEGACY } });
		assert.strictEqual(r.status, 200);
	});

	await t.test('no sale de la carpeta de adjuntos', async () => {
		for (const p of [
			path.join(srv.dir, 'secreto.txt'),
			path.join(srv.root, '..', 'secreto.txt'),
			'/etc/passwd',
		]) {
			const r = await pedir(srv, q(p), { firmar: true });
			assert.strictEqual(r.status, 404, p);
			assert.notStrictEqual(r.text, 'NO', p);
		}
	});

	await t.test('upload fuera de la carpeta: 400 y no escribe', async () => {
		const form = new FormData();
		form.append('path', path.join(srv.dir, 'pisado.txt'));
		form.append('file', new Blob(['x']), 'pisado.txt');
		const r = await pedir(srv, '/upload', { firmar: true, method: 'POST', body: form });
		assert.strictEqual(r.status, 400);
		assert.ok(!fs.existsSync(path.join(srv.dir, 'pisado.txt')));
	});

	await t.test('upload dentro de la carpeta: 201', async () => {
		const form = new FormData();
		form.append('path', path.join(srv.root, '2 GOMEZ', 'b.pdf'));
		form.append('file', new Blob(['nuevo']), 'b.pdf');
		const r = await pedir(srv, '/upload', { firmar: true, method: 'POST', body: form });
		assert.strictEqual(r.status, 201, r.text);
		assert.strictEqual(fs.readFileSync(path.join(srv.root, '2 GOMEZ', 'b.pdf'), 'utf8'), 'nuevo');
	});
});

test('file server sin credenciales no sirve archivos', async (t) => {
	const srv = await levantar({ IMEDIC_FS_SIGNING_KEY: '', IMEDIC_FS_TOKEN: '' });
	t.after(() => srv.cerrar());
	const r = await pedir(srv, q(path.join(srv.root, '1 PEREZ', 'a.pdf')));
	assert.strictEqual(r.status, 503);
	assert.strictEqual(JSON.parse((await pedir(srv, '/health')).text).auth, 'sin-configurar');
});
