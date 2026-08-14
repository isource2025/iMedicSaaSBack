/**
 * Prueba el file server público (túnel) como lo hace el backend iMedic.
 *   node scripts/tunnel/probe-tunnel.js https://xxxx.trycloudflare.com
 */
const axios = require('axios');
const FormData = require('form-data');

const base = String(process.argv[2] || '')
	.trim()
	.replace(/\/+$/, '');
if (!base) {
	console.error('Uso: node scripts/tunnel/probe-tunnel.js https://xxxx.trycloudflare.com');
	process.exit(1);
}

const stamp = new Date().toISOString();
const payload = Buffer.from(`iMedic probe ${stamp}\n`, 'utf8');
const destPath = 'C:\\imedic\\adjuntos\\imedic-probe.txt';

(async () => {
	const out = {};

	const root = await axios.get(base, { timeout: 20000, validateStatus: () => true });
	out.root = { status: root.status, data: root.data };

	const health = await axios.get(`${base}/health`, { timeout: 20000, validateStatus: () => true });
	out.health = { status: health.status, data: health.data };

	const form = new FormData();
	form.append('file', payload, { filename: 'imedic-probe.txt', contentType: 'text/plain' });
	form.append('path', destPath);
	form.append('numeroVisita', 'PROBE');
	const upload = await axios.post(`${base}/upload`, form, {
		headers: form.getHeaders(),
		timeout: 30000,
		maxBodyLength: Infinity,
		validateStatus: () => true,
	});
	out.upload = { status: upload.status, data: upload.data };

	const stored =
		(upload.data && (upload.data.filePath || upload.data.path || upload.data.stored)) || destPath;

	const file = await axios.get(`${base}/file`, {
		params: { path: stored },
		timeout: 20000,
		responseType: 'arraybuffer',
		validateStatus: () => true,
	});
	const ct = String(file.headers['content-type'] || '');
	const body = Buffer.from(file.data);
	out.file = {
		status: file.status,
		contentType: ct,
		bytes: body.length,
		preview: ct.includes('json') || ct.includes('text') ? body.toString('utf8').slice(0, 400) : `<bin ${body.length}>`,
		ok:
			file.status === 200 &&
			!ct.includes('json') &&
			body.includes(Buffer.from('iMedic probe')),
	};

	console.log(JSON.stringify(out, null, 2));
	const ok = out.health.status === 200 && out.upload.status < 400 && out.file.ok;
	process.exit(ok ? 0 : 2);
})().catch((e) => {
	console.error(e.response ? { status: e.response.status, data: e.response.data } : e.message);
	process.exit(1);
});
