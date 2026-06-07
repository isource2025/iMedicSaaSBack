const https = require('https');

const RENAPER_BASE = 'https://federador.msal.gob.ar/masterfile-federacion-service';
const LOGIN_URL = `${RENAPER_BASE}/api/usuarios/aplicacion/login`;
const PERSONA_URL = `${RENAPER_BASE}/api/personas/renaper`;
const COD_DOMINIO = '2.16.840.1.113883.2.10.43';

// Credenciales provistas (mismas que en Clarion)
const CRED_NOMBRE = 'HQgdGgMcFxMaCl4SEh8FDFwCHBcCCBYdBA0B';
const CRED_CLAVE = 'IVQARl0wWyBBFQkLBEclO0M=';

const DEFAULT_TIMEOUT_MS = 30000;
const EXP_SKEW_MS = 5000; // margen para exp
const PROACTIVE_TTL_MS = 60000; // refrescar si restan ≤60s

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/* ------------------------ utilidades base ------------------------ */

function withTimeout(fetcher, ms = DEFAULT_TIMEOUT_MS) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	return {
		signal: ctrl.signal,
		run: fetcher(ctrl).finally(() => clearTimeout(timer)),
	};
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
		if (Array.isArray(payload) && typeof payload[0] === 'string') {
			return JSON.parse(payload[0]);
		}
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
	return null;
}

/* ------------------------ token handling ------------------------ */

async function getFreshToken() {
	const body = { nombre: CRED_NOMBRE, clave: CRED_CLAVE, codDominio: COD_DOMINIO };
	const data = await fetchJSON(LOGIN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	const token = data?.token || data?.Token || data?.access_token || null;
	if (!token) throw new Error(`No se encontró 'token' en login: ${JSON.stringify(data)}`);

	const expMs = decodeJwtExpMs(token);
	const now = Date.now();
	cachedTokenExpiresAt = expMs ? expMs - EXP_SKEW_MS : now + 20000; // fallback 20s si no hay exp
	cachedToken = token;
	return token;
}

async function ensureTokenFresh(minTtlMs = PROACTIVE_TTL_MS) {
	const now = Date.now();
	if (!cachedToken || cachedTokenExpiresAt - now <= minTtlMs) {
		await getFreshToken();
	}
	return cachedToken;
}

async function getToken() {
	const now = Date.now();
	if (cachedToken && now < cachedTokenExpiresAt) return cachedToken;
	return getFreshToken();
}

/* ------------------------ búsqueda persona ------------------------ */

// Acepta codigoError: 0 (OK) y, si allowSigned=true, también 99 (DNI/PAS Firmado)
function isValidResult(res, allowSigned = true) {
	if (!res || typeof res !== 'object') return false;

	if (typeof res.codigoError === 'number') {
		if (res.codigoError === 0) {
			return !!(res.numeroDocumento || res.apellido || res.nombres);
		}
		if (res.codigoError === 99 && allowSigned) {
			return !!(res.numeroDocumento || res.apellido || res.nombres);
		}
		return false;
	}

	return !!(res.numeroDocumento || res.apellido || res.nombres);
}

async function searchOnce(nroDocumento, idSexo, headers, debug = false) {
	const url = new URL(PERSONA_URL);
	url.searchParams.set('nroDocumento', String(nroDocumento).trim());
	url.searchParams.set('idSexo', String(idSexo));

	if (debug) {
		const hlog = { ...headers };
		if (hlog.token) hlog.token = hlog.token.slice(0, 16) + '…';
		if (hlog.Authorization)
			hlog.Authorization = 'Bearer ' + hlog.Authorization.slice(7, 23) + '…';
		console.log('[RENAPER][attempt]', { url: url.toString(), headers: hlog });
	}

	const data = await fetchJSON(url.toString(), { method: 'GET', headers });
	const normalized = normalizePayload(normalizePayload(data));
	if (debug) console.log('[RENAPER][attempt:ok]', normalized);
	return normalized;
}

// Intenta con header `token` y sexo reportado + flip 1↔2
async function tryAttemptsWithToken(nroDocumento, sexoNum, token, debug, allowSigned = true) {
	const results = [];

	// 1) sexoNum tal cual
	try {
		const res = await searchOnce(
			nroDocumento,
			sexoNum,
			{ token, codDominio: COD_DOMINIO },
			debug,
		);
		if (isValidResult(res, allowSigned)) {
			return { ok: true, data: res, meta: { signed: res?.codigoError === 99 } };
		}
		results.push(res);
		if (debug) console.warn('[RENAPER][attempt:invalid] token + idSexo=', sexoNum, res);
	} catch (err) {
		const msg = String(err?.message || '');
		if (debug) console.warn('[RENAPER][attempt:fail] token + idSexo=', sexoNum, msg);
		if (msg.includes('HTTP 401')) throw err;
	}

	// 2) flip 1↔2 (muchas veces necesario)
	const flipped = sexoNum === 1 ? 2 : sexoNum === 2 ? 1 : 0;
	if (flipped) {
		try {
			const res2 = await searchOnce(
				nroDocumento,
				flipped,
				{ token, codDominio: COD_DOMINIO },
				debug,
			);
			if (isValidResult(res2, allowSigned)) {
				return { ok: true, data: res2, meta: { signed: res2?.codigoError === 99 } };
			}
			results.push(res2);
			if (debug)
				console.warn(
					'[RENAPER][attempt:invalid] token + idSexo(flip)=',
					flipped,
					res2,
				);
		} catch (err2) {
			const msg2 = String(err2?.message || '');
			if (debug)
				console.warn('[RENAPER][attempt:fail] token + idSexo(flip)=', flipped, msg2);
			if (msg2.includes('HTTP 401')) throw err2;
		}
	}

	return { ok: false, reason: 'not_found', attempts: results };
}

/* ------------------------ API pública ------------------------ */

const renaperService = {
	// mantiene el nombre público que ya usas
	async getToken() {
		return getToken();
	},

	/**
	 * Busca persona en RENAPER.
	 * @param {string|number} NumeroDocumento
	 * @param {'M'|'F'|1|2|number|string} Sexo  (M/F o 1/2)
	 * @param {{debug?: boolean, allowSigned?: boolean}} opts
	 * @returns {Promise<{ok:true, data:any, meta?:{signed?:boolean}} | {ok:false, reason:'not_found'}>}
	 * @throws Error ante errores 4xx/5xx distintos de 401
	 */
	async search(NumeroDocumento, Sexo, opts = { debug: false, allowSigned: true }) {
		const debug = !!opts.debug;
		const allowSigned = opts.allowSigned !== false; // por defecto true
		await ensureTokenFresh(PROACTIVE_TTL_MS);
		let token = cachedToken;

		const sexoStr = String(Sexo).trim().toUpperCase();
		const sexoNum = sexoStr === 'F' ? 1 : sexoStr === 'M' ? 2 : Number(Sexo) || 0;

		try {
			const first = await tryAttemptsWithToken(
				NumeroDocumento,
				sexoNum,
				token,
				debug,
				allowSigned,
			);
			if (first.ok) return first;
			return { ok: false, reason: 'not_found' };
		} catch (err) {
			const msg = String(err?.message || '');
			if (!msg.includes('HTTP 401')) throw err;
			if (debug) console.warn('[RENAPER] 401; refrescando token y reintentando…');
		}

		// Sólo si hubo 401: refresh y reintento único
		token = await getFreshToken();
		try {
			const second = await tryAttemptsWithToken(
				NumeroDocumento,
				sexoNum,
				token,
				debug,
				allowSigned,
			);
			if (second.ok) return second;
			return { ok: false, reason: 'not_found' };
		} catch (err2) {
			const msg2 = String(err2?.message || '');
			if (debug) console.warn('[RENAPER][retry:fail]', msg2);
			if (msg2.includes('HTTP 401')) {
				// degradamos a not_found para no romper el flujo arriba
				return { ok: false, reason: 'not_found' };
			}
			throw err2;
		}
	},
};

/**
 * Busca persona solo por DNI: prueba ambos sexos en RENAPER (F y M).
 * @returns {Promise<{ok:true, data:any, sexoDetectado?:string, meta?:object} | {ok:false, reason:string}>}
 */
async function searchByDni(NumeroDocumento, opts = { debug: false, allowSigned: true }) {
	for (const sexo of ['M', 'F']) {
		const result = await renaperService.search(NumeroDocumento, sexo, opts);
		if (result.ok && result.data) {
			const rawSexo = result.data.sexo;
			const sexoDetectado =
				rawSexo === 'F' || rawSexo === 'M'
					? rawSexo
					: sexo === 'F'
						? 'F'
						: 'M';
			return { ...result, sexoDetectado };
		}
	}
	return { ok: false, reason: 'not_found' };
}

module.exports = {
	...renaperService,
	searchByDni,
};
