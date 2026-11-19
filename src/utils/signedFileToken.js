/**
 * Token firmado de vida corta para los servicios que corren en cada clínica
 * (file server de adjuntos y bridge PACS). Reemplaza al secreto único
 * compartido: cada clínica tiene su propia clave y cada token vale para UN
 * pedido (método + ruta + query) durante pocos minutos.
 *
 * Formato del token (header `x-imedic-sig` o query `sig`):
 *
 *   v1.<idEmpresa>.<exp>.<firma>
 *
 *   exp    = segundos Unix en que vence
 *   firma  = base64url(HMAC-SHA256(claveClinica, mensaje))
 *   mensaje = ["v1", idEmpresa, METODO, ruta, consulta, exp].join("\n")
 *   ruta     = pathname decodificado, sin "/" final ("/" si queda vacío)
 *   consulta = parámetros del query sin `sig`, decodificados como
 *              URLSearchParams ("+" = espacio), ordenados por "k\0v" en orden
 *              ordinal UTF-16 y unidos como "k=v&k=v"
 *
 * Los instaladores PowerShell (Instalar-Clinica-UnaVez.ps1 e
 * Instalar-Solo-Bridge-Pacs.ps1) arman el mismo mensaje: cualquier cambio acá
 * tiene que replicarse allá y en MiSaludBack.
 */
const crypto = require('crypto');

const VERSION = 'v1';
const HEADER = 'x-imedic-sig';
const QUERY_PARAM = 'sig';
const DEFAULT_TTL_S = 120;
const DEFAULT_SKEW_S = 300;
const DEFAULT_MAX_TTL_S = 900;
/** Largo mínimo de clave aceptado por los servidores de clínica. */
const MIN_KEY_LENGTH = 32;

function base64url(buf) {
	return Buffer.from(buf)
		.toString('base64')
		.replace(/=+$/, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function hmac(key, msg) {
	return crypto.createHmac('sha256', Buffer.from(String(key), 'utf8')).update(msg, 'utf8').digest();
}

function safeEqual(a, b) {
	const x = Buffer.from(String(a || ''), 'utf8');
	const y = Buffer.from(String(b || ''), 'utf8');
	if (x.length !== y.length || x.length === 0) return false;
	return crypto.timingSafeEqual(x, y);
}

/**
 * Ruta y consulta canónicas a partir de `pathname?query` tal como viaja en el
 * request (sin host). Acepta también una URL absoluta.
 */
function canonicalRequest(rawUrl) {
	let s = String(rawUrl || '');
	const abs = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i);
	if (abs) s = s.slice(abs[0].length);
	const hash = s.indexOf('#');
	if (hash >= 0) s = s.slice(0, hash);
	const qi = s.indexOf('?');
	const rawPath = qi >= 0 ? s.slice(0, qi) : s;
	const rawQuery = qi >= 0 ? s.slice(qi + 1) : '';

	let ruta = rawPath;
	try {
		ruta = decodeURIComponent(rawPath);
	} catch {
		/* se firma tal cual */
	}
	ruta = ruta.replace(/\/+$/, '') || '/';

	const pares = [];
	for (const [k, v] of new URLSearchParams(rawQuery)) {
		if (k === QUERY_PARAM) continue;
		pares.push(`${k}\0${v}`);
	}
	pares.sort();
	const consulta = pares.map((p) => p.replace('\0', '=')).join('&');
	return { ruta, consulta };
}

function mensaje({ idEmpresa, method, ruta, consulta, exp }) {
	return [VERSION, String(idEmpresa), String(method || 'GET').toUpperCase(), ruta, consulta, String(exp)].join(
		'\n',
	);
}

/**
 * @param {{ key: string, idEmpresa: number|string, method: string, url: string, ttlS?: number, now?: number }} p
 * @returns {string} token
 */
function signRequest({ key, idEmpresa, method, url, ttlS = DEFAULT_TTL_S, now = Date.now() }) {
	if (!key) throw new Error('signRequest: falta la clave de la clínica');
	const exp = Math.floor(now / 1000) + Math.max(1, Math.floor(ttlS));
	const { ruta, consulta } = canonicalRequest(url);
	const firma = base64url(hmac(key, mensaje({ idEmpresa, method, ruta, consulta, exp })));
	return `${VERSION}.${idEmpresa}.${exp}.${firma}`;
}

/**
 * @returns {{ ok: true, idEmpresa: string, exp: number } | { ok: false, motivo: string }}
 */
function verifyRequest({
	token,
	key,
	method,
	url,
	now = Date.now(),
	skewS = DEFAULT_SKEW_S,
	maxTtlS = DEFAULT_MAX_TTL_S,
	idEmpresaEsperada,
}) {
	if (!key || String(key).length < MIN_KEY_LENGTH) return { ok: false, motivo: 'sin-clave' };
	const partes = String(token || '').trim().split('.');
	if (partes.length !== 4 || partes[0] !== VERSION) return { ok: false, motivo: 'formato' };
	const [, idEmpresa, expRaw, firma] = partes;
	if (!/^\d+$/.test(idEmpresa) || !/^\d+$/.test(expRaw)) return { ok: false, motivo: 'formato' };
	if (idEmpresaEsperada != null && String(idEmpresaEsperada).trim() !== '' && String(idEmpresaEsperada).trim() !== idEmpresa) {
		return { ok: false, motivo: 'empresa' };
	}
	const exp = Number(expRaw);
	const ahora = Math.floor(now / 1000);
	if (ahora > exp + skewS) return { ok: false, motivo: 'vencido' };
	if (exp > ahora + maxTtlS + skewS) return { ok: false, motivo: 'vida-excesiva' };

	const { ruta, consulta } = canonicalRequest(url);
	const esperada = base64url(hmac(key, mensaje({ idEmpresa, method, ruta, consulta, exp })));
	if (!safeEqual(firma, esperada)) return { ok: false, motivo: 'firma' };
	return { ok: true, idEmpresa, exp };
}

/** Token presente en el request: header `x-imedic-sig` o `?sig=`. */
function tokenFromRequest(headers, rawUrl) {
	const h = headers && (headers[HEADER] || headers[HEADER.toLowerCase()]);
	if (h) return String(Array.isArray(h) ? h[0] : h).trim();
	const s = String(rawUrl || '');
	const qi = s.indexOf('?');
	if (qi < 0) return '';
	return String(new URLSearchParams(s.slice(qi + 1)).get(QUERY_PARAM) || '').trim();
}

/** Clave de una clínica derivada de la clave maestra del backend. */
function deriveClinicKey(master, servicio, idEmpresa) {
	return crypto
		.createHmac('sha256', Buffer.from(String(master), 'utf8'))
		.update(`imedic:${servicio}:${idEmpresa}`, 'utf8')
		.digest('hex');
}

/** `{"101":"clave"}` o `101:clave,102:clave`. */
function parseKeyMap(raw) {
	const s = String(raw || '').trim();
	if (!s) return {};
	if (s.startsWith('{')) {
		try {
			const obj = JSON.parse(s);
			const out = {};
			for (const [k, v] of Object.entries(obj || {})) {
				if (v != null && String(v).trim()) out[String(k).trim()] = String(v).trim();
			}
			return out;
		} catch {
			console.warn('[signedFileToken] mapa de claves con JSON inválido; se ignora');
			return {};
		}
	}
	const out = {};
	for (const par of s.split(/[,;\s]+/)) {
		const i = par.indexOf(':');
		if (i <= 0) continue;
		const k = par.slice(0, i).trim();
		const v = par.slice(i + 1).trim();
		if (k && v) out[k] = v;
	}
	return out;
}

const SERVICIOS = {
	fs: { mapEnv: 'FILE_SERVER_SIGNING_KEYS', ttlEnv: 'FILE_SERVER_SIGNING_TTL_S' },
	pacs: { mapEnv: 'PACS_SIGNING_KEYS', ttlEnv: 'PACS_SIGNING_TTL_S' },
};

/**
 * Clave con la que el backend firma los pedidos a una clínica. Primero el
 * mapa explícito por empresa; si no está, la derivada de IMEDIC_SIGNING_MASTER.
 * Vacío = esa clínica todavía no usa token firmado.
 */
function clinicKeyFor(servicio, idEmpresa) {
	const cfg = SERVICIOS[servicio];
	const id = Number(idEmpresa);
	if (!cfg || !Number.isFinite(id) || id <= 0) return '';
	const explicita = parseKeyMap(process.env[cfg.mapEnv])[String(id)];
	if (explicita) return explicita;
	const master = String(process.env.IMEDIC_SIGNING_MASTER || '').trim();
	return master ? deriveClinicKey(master, servicio, id) : '';
}

function ttlFor(servicio) {
	const cfg = SERVICIOS[servicio];
	const n = Number(cfg && process.env[cfg.ttlEnv]);
	return Number.isFinite(n) && n > 0 ? Math.min(n, DEFAULT_MAX_TTL_S) : DEFAULT_TTL_S;
}

/**
 * Header interno que marca un pedido axios para firmar. Lo agregan
 * fileServerHeaders()/pacsHeaders() y lo reemplaza el interceptor por
 * `x-imedic-sig`, porque recién ahí se conoce la URL final con sus params.
 */
const MARK_HEADER = 'x-imedic-sign-request';

function markForSigning(headers, servicio, idEmpresa) {
	if (clinicKeyFor(servicio, idEmpresa)) headers[MARK_HEADER] = `${servicio}:${Number(idEmpresa)}`;
	return headers;
}

function readHeader(headers, name) {
	if (!headers) return undefined;
	if (typeof headers.get === 'function') {
		const v = headers.get(name);
		if (v != null) return v;
	}
	return headers[name];
}

function removeHeader(headers, name) {
	if (!headers) return;
	if (typeof headers.delete === 'function') headers.delete(name);
	delete headers[name];
}

const instalados = new WeakSet();

function installAxiosSigner(axiosInstance) {
	if (!axiosInstance || instalados.has(axiosInstance)) return;
	instalados.add(axiosInstance);
	axiosInstance.interceptors.request.use((config) => {
		const marca = readHeader(config.headers, MARK_HEADER);
		if (!marca) return config;
		removeHeader(config.headers, MARK_HEADER);
		const [servicio, id] = String(marca).split(':');
		const key = clinicKeyFor(servicio, id);
		if (!key) return config;
		const url = axiosInstance.getUri(config);
		const token = signRequest({ key, idEmpresa: Number(id), method: config.method || 'get', url, ttlS: ttlFor(servicio) });
		if (typeof config.headers.set === 'function') config.headers.set(HEADER, token);
		else config.headers[HEADER] = token;
		return config;
	});
}

module.exports = {
	HEADER,
	QUERY_PARAM,
	MIN_KEY_LENGTH,
	MARK_HEADER,
	DEFAULT_TTL_S,
	DEFAULT_SKEW_S,
	DEFAULT_MAX_TTL_S,
	canonicalRequest,
	signRequest,
	verifyRequest,
	tokenFromRequest,
	deriveClinicKey,
	parseKeyMap,
	clinicKeyFor,
	markForSigning,
	installAxiosSigner,
	safeEqual,
};
