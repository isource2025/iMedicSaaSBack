// renaper.service.js
const https = require('https');

const RENAPER_BASE = 'https://federador.msal.gob.ar/masterfile-federacion-service';
const LOGIN_URL = `${RENAPER_BASE}/api/usuarios/aplicacion/login`;
const PERSONA_URL = `${RENAPER_BASE}/api/personas/renaper`;
const COD_DOMINIO = '2.16.840.1.113883.2.10.43';

const CRED_NOMBRE = 'HQgdGgMcFxMaCl4SEh8FDFwCHBcCCBYdBA0B';
const CRED_CLAVE = 'IVQARl0wWyBBFQkLBEclO0M=';

const DEFAULT_TIMEOUT_MS = 30000;
const EXP_SKEW_MS = 5000; // margen de 5s para evitar llegar justo al exp

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function withTimeout(fetcher, ms = DEFAULT_TIMEOUT_MS) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	return { signal: ctrl.signal, run: fetcher(ctrl).finally(() => clearTimeout(timer)) };
}

async function fetchJSON(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
	const { run } = withTimeout(async (ctrl) => {
		const resp = await fetch(url, {
			agent,
			signal: ctrl.signal,
			...options,
			headers: { Accept: 'application/json', ...(options.headers || {}) },
		});
		const text = await resp.text();
		if (!resp.ok) {
			let payload = text;
			try {
				payload = JSON.parse(text);
			} catch {}
			const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
			throw new Error(`HTTP ${resp.status} ${resp.statusText} - ${msg}`);
		}
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}, timeoutMs);
	return run;
}

function normalizePayload(payload) {
	try {
		if (payload == null) return payload;
		if (typeof payload === 'string') return JSON.parse(payload.trim());
		if (Array.isArray(payload) && typeof payload[0] === 'string')
			return JSON.parse(payload[0]);
		return payload;
	} catch {
		return payload;
	}
}

function decodeJwtExpMs(token) {
	try {
		const [, base64Payload] = token.split('.');
		const json = Buffer.from(
			base64Payload.replace(/-/g, '+').replace(/_/g, '/'),
			'base64',
		).toString('utf8');
		const payload = JSON.parse(json);
		if (typeof payload.exp === 'number') return payload.exp * 1000;
	} catch {}
	return null; // si no hay exp, devolvemos null
}

async function getFreshToken() {
	const body = { nombre: CRED_NOMBRE, clave: CRED_CLAVE, codDominio: COD_DOMINIO };
	const data = await fetchJSON(LOGIN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	const token = data?.token || data?.Token || data?.access_token || null;
	if (!token) throw new Error(`No se encontró 'token' en login: ${JSON.stringify(data)}`);

	// calcular expiración real desde el JWT
	const expMs = decodeJwtExpMs(token);
	const now = Date.now();
	// si no pudimos leer exp, forzamos TTL muy corto (20s)
	cachedTokenExpiresAt = expMs ? expMs - EXP_SKEW_MS : now + 20000;
	cachedToken = token;
	return token;
}

async function getToken() {
	const now = Date.now();
	if (cachedToken && now < cachedTokenExpiresAt) return cachedToken;
	return await getFreshToken();
}

async function searchOnce(NumeroDocumento, Sexo, headers, idSexo, debug = false) {
	const url = new URL(PERSONA_URL);
	url.searchParams.set('nroDocumento', String(NumeroDocumento).trim());
	url.searchParams.set('idSexo', idSexo);

	if (debug) console.log('[RENAPER][attempt]', { url: url.toString(), headers });

	const data = await fetchJSON(url.toString(), { method: 'GET', headers });
	const normalized = normalizePayload(normalizePayload(data));
	if (debug) console.log('[RENAPER][attempt:ok]', normalized);
	return normalized;
}

const renaperService = {
	async getToken() {
		return getToken();
	},

	async search(NumeroDocumento, Sexo, opts = { debug: false }) {
		let token = await getToken();

		const sexoStr = String(Sexo).trim().toUpperCase();
		const sexoNum = sexoStr === 'F' ? 1 : sexoStr === 'M' ? 2 : Number(Sexo) || 0;

		const attempts = (tok) => [
			{
				name: 'token-header + idSexo(num)',
				headers: { token: tok, codDominio: COD_DOMINIO },
				idSexo: String(sexoNum),
			},
			{
				name: 'bearer + idSexo(num)',
				headers: { Authorization: `Bearer ${tok}`, codDominio: COD_DOMINIO },
				idSexo: String(sexoNum),
			},
			{
				name: 'bearer + idSexo(F/M)',
				headers: { Authorization: `Bearer ${tok}`, codDominio: COD_DOMINIO },
				idSexo: sexoStr,
			},
		];

		// Ejecuta los intentos con el token actual
		try {
			let lastErr = null;
			for (const attempt of attempts(token)) {
				try {
					return await searchOnce(
						NumeroDocumento,
						Sexo,
						attempt.headers,
						attempt.idSexo,
						opts.debug,
					);
				} catch (err) {
					lastErr = err;
					if (opts.debug)
						console.warn('[RENAPER][attempt:fail]', attempt.name, String(err));
					// Si no es 401, no seguimos probando combinaciones
					if (!String(err?.message || '').includes('HTTP 401')) continue;
				}
			}
			// Si llegamos aquí, o no hubo 200 o todo fue 401: caemos a refresh
			throw lastErr || new Error('Fallaron los intentos con el token actual.');
		} catch (err) {
			// Si el error fue 401 (ExpiredToken/InsufficientAuthentication), refresca y reintenta una vez
			const msg = String(err?.message || '');
			if (msg.includes('HTTP 401')) {
				if (opts.debug)
					console.warn(
						'[RENAPER] 401 detectado, refrescando token y reintentando...',
					);
				token = await getFreshToken();

				let lastErr2 = null;
				for (const attempt of attempts(token)) {
					try {
						return await searchOnce(
							NumeroDocumento,
							Sexo,
							attempt.headers,
							attempt.idSexo,
							opts.debug,
						);
					} catch (err2) {
						lastErr2 = err2;
						if (opts.debug)
							console.warn('[RENAPER][retry:fail]', attempt.name, String(err2));
					}
				}
				throw lastErr2 || new Error('Reintentos con token fresco fallaron.');
			}
			// Propaga otros errores (400/500 reales)
			throw err;
		}
	},
};

module.exports = renaperService;
