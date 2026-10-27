/**
 * Llama a las rutas Express existentes por HTTP local.
 * Cada herramienta hereda auth, tenant, permisos, validación y auditoría.
 */
const http = require('http');

const TIMEOUT_MS = Number(process.env.ASISTENTE_HTTP_TIMEOUT_MS) || 25000;

let _app = null;
let _server = null;
let _baseUrl = null;
let _starting = null;

function bindApp(app) {
	if (!app || typeof app.handle !== 'function') {
		throw new Error('asistente.httpInterno: se requiere la app Express');
	}
	_app = app;
	cerrarServer();
}

function getApp() {
	if (!_app) throw new Error('asistente.httpInterno: app no enlazada (bindApp)');
	return _app;
}

function cerrarServer() {
	_baseUrl = null;
	_starting = null;
	if (_server) {
		try {
			_server.close();
		} catch {
			/* noop */
		}
		_server = null;
	}
}

function ensureServer() {
	if (_baseUrl) return Promise.resolve(_baseUrl);
	if (_starting) return _starting;
	getApp();
	_starting = new Promise((resolve, reject) => {
		_server = http.createServer(_app);
		_server.once('error', (err) => {
			_starting = null;
			_server = null;
			reject(err);
		});
		_server.listen(0, '127.0.0.1', () => {
			const addr = _server.address();
			_baseUrl = `http://127.0.0.1:${addr.port}`;
			resolve(_baseUrl);
		});
	});
	return _starting;
}

function armarQuery(path, query) {
	if (!query || typeof query !== 'object') return path;
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v == null || v === '') continue;
		params.append(k, String(v));
	}
	const qs = params.toString();
	if (!qs) return path;
	return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

/**
 * @param {{
 *   method: string,
 *   path: string,
 *   query?: Record<string, unknown>,
 *   body?: unknown,
 *   headers?: Record<string, string>,
 * }} opts
 */
async function llamar({ method, path, query, body, headers }) {
	const base = await ensureServer();
	const url = base + armarQuery(path, query);
	const verb = String(method || 'GET').toUpperCase();
	const hdrs = { ...(headers || {}), 'x-imedic-asistente': '1' };
	const tieneBody = body !== undefined && body !== null && verb !== 'GET' && verb !== 'HEAD';
	if (tieneBody && !hdrs['content-type'] && !hdrs['Content-Type']) {
		hdrs['content-type'] = 'application/json';
	}

	const resp = await fetch(url, {
		method: verb,
		headers: hdrs,
		body: tieneBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	const raw = await resp.text();
	let parsed = raw;
	if (raw) {
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = { raw: raw.slice(0, 2000) };
		}
	} else {
		parsed = null;
	}

	const outHeaders = {};
	resp.headers.forEach((v, k) => {
		outHeaders[k] = v;
	});
	return { status: resp.status, body: parsed, headers: outHeaders };
}

function headersDesdeReq(req, token) {
	const headers = {};
	if (token) headers.authorization = `Bearer ${token}`;
	else if (req?.headers?.authorization) headers.authorization = req.headers.authorization;
	if (req?.headers?.cookie) headers.cookie = req.headers.cookie;
	if (req?.headers['user-agent']) headers['user-agent'] = req.headers['user-agent'];
	return headers;
}

process.on('exit', cerrarServer);

module.exports = {
	bindApp,
	getApp,
	llamar,
	headersDesdeReq,
	armarQuery,
	cerrarServer,
};
