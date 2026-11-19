/** /media/patients y /uploads: URL firmada o sesión; nada más sale por /uploads. */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { requireMediaAccess, onlyLegacyPhotoPaths } = require('../src/middlewares/mediaAccess.middleware');
const { signMediaUrl } = require('../src/utils/mediaUrl');

test('fotos de pacientes', async (t) => {
	const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
	const fotos = path.join(uploads, 'patient-photos');
	fs.mkdirSync(fotos);
	fs.mkdirSync(path.join(uploads, 'requisitos'));
	fs.writeFileSync(path.join(fotos, 'p_1.jpg'), 'FOTO');
	fs.writeFileSync(path.join(uploads, 'viejo.jpg'), 'VIEJA');
	fs.writeFileSync(path.join(uploads, 'requisitos', 'dni.pdf'), 'DNI');

	const app = express();
	const opts = { cacheControl: false, dotfiles: 'deny', index: false, redirect: false };
	app.use('/uploads', onlyLegacyPhotoPaths, requireMediaAccess, express.static(uploads, opts));
	app.use('/media/patients', requireMediaAccess, express.static(fotos, opts));
	const server = await new Promise((r) => {
		const s = app.listen(0, '127.0.0.1', () => r(s));
	});
	t.after(() => {
		server.close();
		fs.rmSync(uploads, { recursive: true, force: true });
	});
	const base = `http://127.0.0.1:${server.address().port}`;
	const get = (u) => fetch(`${base}${u}`);

	await t.test('sin firma ni sesión: 401', async () => {
		assert.strictEqual((await get('/media/patients/p_1.jpg')).status, 401);
		assert.strictEqual((await get('/uploads/viejo.jpg')).status, 401);
	});

	await t.test('con URL firmada: 200 y cacheable privado', async () => {
		const r = await get(signMediaUrl('/media/patients/p_1.jpg'));
		assert.strictEqual(r.status, 200);
		assert.strictEqual(await r.text(), 'FOTO');
		assert.strictEqual(r.headers.get('cache-control'), 'private, max-age=3600');
		const legado = await get(signMediaUrl('/uploads/viejo.jpg'));
		assert.strictEqual(legado.status, 200);
	});

	await t.test('la firma de una foto no abre otra', async () => {
		const u = new URL(signMediaUrl('/media/patients/p_1.jpg'), base);
		assert.strictEqual((await get(`/media/patients/otra.jpg${u.search}`)).status, 401);
	});

	await t.test('/uploads no expone otras carpetas, ni firmando', async () => {
		assert.strictEqual((await get(signMediaUrl('/uploads/requisitos/dni.pdf'))).status, 404);
		assert.strictEqual((await get('/uploads/requisitos/dni.pdf')).status, 404);
		assert.strictEqual((await get('/uploads/.env')).status, 404);
	});
});
