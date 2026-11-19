const test = require('node:test');
const assert = require('node:assert');
const { signMediaUrl, stripMediaSignature, verifyMediaRequest } = require('./mediaUrl');

const NOW = 1_800_000_000_000;

function query(url) {
	return Object.fromEntries(new URL(url, 'http://x').searchParams);
}

test('firma URLs relativas y absolutas de fotos y las verifica', () => {
	const rel = signMediaUrl('/media/patients/p_1.jpg', { now: NOW });
	assert.match(rel, /^\/media\/patients\/p_1\.jpg\?exp=\d+&sig=[\w-]+$/);
	assert.ok(verifyMediaRequest('/media/patients/p_1.jpg', query(rel), NOW));

	const abs = signMediaUrl('https://api.test/uploads/patient-photos/a%20b.png', { now: NOW });
	assert.ok(abs.startsWith('https://api.test/uploads/patient-photos/a%20b.png?exp='));
	assert.ok(verifyMediaRequest('/uploads/patient-photos/a%20b.png', query(abs), NOW));
});

test('la firma no sirve para otra foto ni después de vencer', () => {
	const q = query(signMediaUrl('/media/patients/p_1.jpg', { now: NOW }));
	assert.ok(!verifyMediaRequest('/media/patients/p_2.jpg', q, NOW));
	assert.ok(!verifyMediaRequest('/media/patients/p_1.jpg', q, (Number(q.exp) + 1) * 1000));
	assert.ok(!verifyMediaRequest('/media/patients/p_1.jpg', { ...q, exp: String(Number(q.exp) + 3600) }, NOW));
	assert.ok(!verifyMediaRequest('/media/patients/p_1.jpg', {}, NOW));
});

test('la URL es estable dentro de la misma hora (cache del navegador)', () => {
	const inicioHora = 1_800_000_000 - (1_800_000_000 % 3600);
	const a = signMediaUrl('/media/patients/p.jpg', { now: (inicioHora + 1) * 1000 });
	const b = signMediaUrl('/media/patients/p.jpg', { now: (inicioHora + 1800) * 1000 });
	assert.strictEqual(Number(query(a).exp) % 3600, 0);
	assert.strictEqual(a, b);
});

test('no toca otras URLs; strip deja la URL original para guardar', () => {
	assert.strictEqual(signMediaUrl('https://cdn.test/foto.jpg'), 'https://cdn.test/foto.jpg');
	assert.strictEqual(signMediaUrl(''), '');
	assert.strictEqual(signMediaUrl(null), null);
	const s = signMediaUrl('https://api.test/media/patients/p.jpg', { now: NOW });
	assert.strictEqual(stripMediaSignature(s), 'https://api.test/media/patients/p.jpg');
	assert.strictEqual(stripMediaSignature('/media/patients/p.jpg'), '/media/patients/p.jpg');
	const doble = signMediaUrl(s, { now: NOW });
	assert.strictEqual((doble.match(/sig=/g) || []).length, 1);
});
