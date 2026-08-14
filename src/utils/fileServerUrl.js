/**
 * URL pública del file server de adjuntos por empresa.
 *
 * Producción (Railway): SIEMPRE Empresas.FileServerUrl (túnel trycloudflare).
 * El front NUNCA habla con la IP ni con 127.0.0.1:9012 — eso solo existe en la PC de la clínica.
 * cloudflared en esa PC publica 127.0.0.1:9012 como https://xxxx.trycloudflare.com
 *
 * Vidal (empresa 1) es la excepción histórica: IP http://181.4.71.230:3002 si no hay túnel.
 */
const { getTenantId } = require('../context/tenantContext');

const DEFAULT_VIDAL_FILE_SERVER_URL = 'http://181.4.71.230:3002';
const VIDAL_EMPRESA_ID = Number(process.env.VIDAL_EMPRESA_ID || 1);

function normalizeBaseUrl(url) {
	return String(url || '')
		.trim()
		.replace(/\/+$/, '');
}

function isCloudRuntime() {
	return (
		process.env.NODE_ENV === 'production' ||
		Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME)
	);
}

function hostnameOf(url) {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return '';
	}
}

/** Railway no puede llegar a localhost ni a la LAN de la clínica. */
function isUnreachableFromCloud(url) {
	const host = hostnameOf(url);
	if (!host) return true;
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
	if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
	if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
	if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
	return false;
}

function pickUsableUrl(url) {
	const n = normalizeBaseUrl(url);
	if (!n) return '';
	if (isCloudRuntime() && isUnreachableFromCloud(n)) return '';
	return n;
}

function missingUrlError(id) {
	const err = new Error(
		`La empresa ${id} no tiene FileServerUrl de túnel. En la PC de la clínica hay que correr Start-QuickTunnel.ps1 (no sirve la IP local ni 127.0.0.1).`,
	);
	err.code = 'FILE_SERVER_URL_MISSING';
	return err;
}

/**
 * @param {number|string|null} [idEmpresaOpt]
 * @returns {Promise<string>}
 */
async function resolveFileServerUrl(idEmpresaOpt) {
	const idRaw = idEmpresaOpt != null && idEmpresaOpt !== '' ? idEmpresaOpt : getTenantId();
	const id = Number(idRaw);

	if (Number.isFinite(id) && id > 0) {
		try {
			const { loadEmpresaConnectionRow } = require('../config/tenantDb');
			const row = await loadEmpresaConnectionRow(id);
			const fromEmpresa = pickUsableUrl(row?.FileServerUrl);
			if (fromEmpresa) return fromEmpresa;
		} catch (e) {
			if (e.code === 'FILE_SERVER_URL_MISSING') throw e;
			console.warn(`[fileServerUrl] empresa ${id}:`, e.message);
		}
	}

	// Vidal: IP histórica del file server en su red. El resto de empresas: solo túnel en BD.
	if (id === VIDAL_EMPRESA_ID) {
		const vidal =
			pickUsableUrl(process.env.FILE_SERVER_URL) || pickUsableUrl(DEFAULT_VIDAL_FILE_SERVER_URL);
		if (vidal) return vidal;
	}

	const envUrl = pickUsableUrl(process.env.FILE_SERVER_URL);
	if (envUrl && !isCloudRuntime()) return envUrl;

	throw missingUrlError(Number.isFinite(id) && id > 0 ? id : '?');
}

function fileServerStatus(err) {
	return err && err.response ? Number(err.response.status) : 0;
}

function fileServerBodyText(err) {
	const data = err && err.response && err.response.data;
	if (data == null) return '';
	if (typeof data === 'string') return data;
	if (Buffer.isBuffer(data)) return data.toString('utf8');
	try {
		return JSON.stringify(data);
	} catch {
		return String(data);
	}
}

/** Timeout, DNS, conexión, o Cloudflare 530/1033 (túnel caído). */
function isFileServerUnreachable(err) {
	const code = err && (err.code || (err.cause && err.cause.code));
	if (
		code === 'ETIMEDOUT' ||
		code === 'ECONNREFUSED' ||
		code === 'ENOTFOUND' ||
		code === 'EHOSTUNREACH' ||
		code === 'ECONNABORTED'
	) {
		return true;
	}
	const status = fileServerStatus(err);
	if (status === 530 || status === 1033 || status === 502) return true;
	const body = fileServerBodyText(err);
	return /errorCode:\s*1033/i.test(body) || /Cloudflare Tunnel error/i.test(body);
}

function describeFileServerError(err) {
	const status = fileServerStatus(err);
	const body = fileServerBodyText(err);
	if (
		status === 530 ||
		status === 1033 ||
		/errorCode:\s*1033/i.test(body) ||
		/Cloudflare Tunnel error/i.test(body)
	) {
		return 'El túnel de adjuntos está caído (Cloudflare 530). En la PC de la clínica hay que volver a correr Start-QuickTunnel.ps1; si cambia la URL de trycloudflare, se actualiza sola en Super Admin.';
	}
	if (err && (err.code === 'FILE_SERVER_BAD_UPLOAD' || err.code === 'FILE_SERVER_URL_MISSING')) {
		return err.message;
	}
	if (isFileServerUnreachable(err)) {
		return 'No se pudo contactar el servidor de archivos (timeout o red). En la PC de la clínica tiene que estar corriendo el túnel y el file server (Start-QuickTunnel.ps1). Revise FileServerUrl de la empresa.';
	}
	return (err && err.message) || 'Error al subir archivo';
}

/** Ruta que devolvió el file server de iMedic. El stub (stored/upload.bin) no cuenta. */
function pickUploadedFilePath(data) {
	const raw = data && (data.filePath || data.path);
	const p = raw != null ? String(raw).trim() : '';
	if (!p) {
		const err = new Error(
			'El servidor de archivos no guardó el adjunto. En la PC de la clínica hay que usar start-file-server.bat (no el proceso que deja upload.bin).',
		);
		err.code = 'FILE_SERVER_BAD_UPLOAD';
		throw err;
	}
	return p;
}

/** El file server de Sarmiento a veces manda ok:true en vez de success:true. */
function fileServerUploadOk(data) {
	if (!data || typeof data !== 'object') return false;
	if (data.success === true || data.ok === true) return true;
	try {
		pickUploadedFilePath(data);
		return true;
	} catch {
		return false;
	}
}

module.exports = {
	DEFAULT_VIDAL_FILE_SERVER_URL,
	DEFAULT_FILE_SERVER_URL: DEFAULT_VIDAL_FILE_SERVER_URL,
	normalizeBaseUrl,
	resolveFileServerUrl,
	pickUploadedFilePath,
	fileServerUploadOk,
	isFileServerUnreachable,
	describeFileServerError,
	isUnreachableFromCloud,
};
