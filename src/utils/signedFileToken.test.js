const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const {
	canonicalRequest,
	signRequest,
	verifyRequest,
	tokenFromRequest,
	deriveClinicKey,
	parseKeyMap,
	clinicKeyFor,
	markForSigning,
	installAxiosSigner,
	HEADER,
	MARK_HEADER,
} = require('./signedFileToken');

const KEY = 'k'.repeat(40);
const NOW = 1_800_000_000_000;
const URL_FILE = '/file?path=C%253A%255Cimedic%255Cadjuntos%255C1%2520PE%25C3%2591A%255Ca.pdf';

test('firma y verifica el mismo pedido', () => {
	const token = signRequest({ key: KEY, idEmpresa: 101, method: 'get', url: URL_FILE, now: NOW });
	assert.match(token, /^v1\.101\.\d+\.[A-Za-z0-9_-]+$/);
	const r = verifyRequest({ token, key: KEY, method: 'GET', url: URL_FILE, now: NOW + 5000 });
	assert.deepStrictEqual(r, { ok: true, idEmpresa: '101', exp: Math.floor(NOW / 1000) + 120 });
});

test('la URL absoluta y la relativa firman igual; el orden del query y sig no importan', () => {
	const a = signRequest({ key: KEY, idEmpresa: 1, method: 'GET', url: `https://files-x.imedic.com.ar/studies?b=2&a=1`, now: NOW });
	const r = verifyRequest({ token: a, key: KEY, method: 'GET', url: `/studies/?a=1&sig=xxx&b=2`, now: NOW });
	assert.strictEqual(r.ok, true);
});

test('rechaza otra ruta, otro método, otra clínica, otra clave', () => {
	const token = signRequest({ key: KEY, idEmpresa: 101, method: 'GET', url: URL_FILE, now: NOW });
	const base = { token, key: KEY, method: 'GET', url: URL_FILE, now: NOW };
	assert.strictEqual(verifyRequest({ ...base, url: '/file?path=otro.pdf' }).motivo, 'firma');
	assert.strictEqual(verifyRequest({ ...base, method: 'DELETE' }).motivo, 'firma');
	assert.strictEqual(verifyRequest({ ...base, key: 'z'.repeat(40) }).motivo, 'firma');
	assert.strictEqual(verifyRequest({ ...base, idEmpresaEsperada: 102 }).motivo, 'empresa');
	const otraEmpresa = token.replace('v1.101.', 'v1.102.');
	assert.strictEqual(verifyRequest({ ...base, token: otraEmpresa }).motivo, 'firma');
});

test('vencimiento, vida excesiva, formato y clave corta', () => {
	const token = signRequest({ key: KEY, idEmpresa: 1, method: 'GET', url: '/health', now: NOW });
	const base = { token, key: KEY, method: 'GET', url: '/health' };
	assert.strictEqual(verifyRequest({ ...base, now: NOW + (120 + 300) * 1000 }).ok, true);
	assert.strictEqual(verifyRequest({ ...base, now: NOW + (120 + 301) * 1000 }).motivo, 'vencido');
	const largo = signRequest({ key: KEY, idEmpresa: 1, method: 'GET', url: '/health', now: NOW, ttlS: 86400 });
	assert.strictEqual(verifyRequest({ ...base, token: largo, now: NOW }).motivo, 'vida-excesiva');
	assert.strictEqual(verifyRequest({ ...base, token: 'basura', now: NOW }).motivo, 'formato');
	assert.strictEqual(verifyRequest({ ...base, key: 'corta', now: NOW }).motivo, 'sin-clave');
});

test('canonicalRequest decodifica path y query como URLSearchParams', () => {
	assert.deepStrictEqual(canonicalRequest('/studies/1.2%2E3/file/?path=a+b%2Fc&z=&a=1'), {
		ruta: '/studies/1.2.3/file',
		consulta: 'a=1&path=a b/c&z=',
	});
	assert.deepStrictEqual(canonicalRequest('https://h.test'), { ruta: '/', consulta: '' });
});

test('tokenFromRequest: header o ?sig=', () => {
	assert.strictEqual(tokenFromRequest({ [HEADER]: ' abc ' }, '/x'), 'abc');
	assert.strictEqual(tokenFromRequest({}, '/x?sig=v1.1.2.zz&a=1'), 'v1.1.2.zz');
	assert.strictEqual(tokenFromRequest({}, '/x'), '');
});

test('claves por clínica: mapa explícito y derivación de la maestra', (t) => {
	const prev = { ...process.env };
	t.after(() => {
		for (const k of ['FILE_SERVER_SIGNING_KEYS', 'PACS_SIGNING_KEYS', 'IMEDIC_SIGNING_MASTER']) {
			if (prev[k] === undefined) delete process.env[k];
			else process.env[k] = prev[k];
		}
	});
	assert.deepStrictEqual(parseKeyMap('101:aaa, 102:bbb'), { 101: 'aaa', 102: 'bbb' });
	assert.deepStrictEqual(parseKeyMap('{"5":"x"}'), { 5: 'x' });
	delete process.env.IMEDIC_SIGNING_MASTER;
	process.env.FILE_SERVER_SIGNING_KEYS = '{"101":"explicita"}';
	delete process.env.PACS_SIGNING_KEYS;
	assert.strictEqual(clinicKeyFor('fs', 101), 'explicita');
	assert.strictEqual(clinicKeyFor('fs', 102), '');
	process.env.IMEDIC_SIGNING_MASTER = 'maestra';
	assert.strictEqual(clinicKeyFor('pacs', 102), deriveClinicKey('maestra', 'pacs', 102));
	assert.notStrictEqual(deriveClinicKey('maestra', 'fs', 102), deriveClinicKey('maestra', 'pacs', 102));
	assert.match(deriveClinicKey('maestra', 'fs', 1), /^[0-9a-f]{64}$/);
});

test('interceptor axios: reemplaza la marca por una firma válida de la URL final', async (t) => {
	const prev = process.env.FILE_SERVER_SIGNING_KEYS;
	t.after(() => {
		if (prev === undefined) delete process.env.FILE_SERVER_SIGNING_KEYS;
		else process.env.FILE_SERVER_SIGNING_KEYS = prev;
	});
	process.env.FILE_SERVER_SIGNING_KEYS = JSON.stringify({ 7: KEY });
	const inst = axios.create();
	installAxiosSigner(inst);
	let visto;
	inst.defaults.adapter = async (config) => {
		visto = config;
		return { data: '', status: 200, statusText: 'OK', headers: {}, config };
	};
	const headers = markForSigning({ 'x-otro': '1' }, 'fs', 7);
	assert.strictEqual(headers[MARK_HEADER], 'fs:7');
	await inst.get('https://files-x.imedic.com.ar/file', { headers, params: { path: 'C:\\a b\\ñ.pdf' } });
	assert.strictEqual(visto.headers.get(MARK_HEADER), undefined);
	const token = visto.headers.get(HEADER);
	const url = inst.getUri(visto);
	assert.strictEqual(verifyRequest({ token, key: KEY, method: 'GET', url }).ok, true);

	assert.deepStrictEqual(markForSigning({}, 'fs', 8), {}, 'sin clave para la empresa no marca');
});
