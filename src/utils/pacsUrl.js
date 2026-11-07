/**
 * URL pública del bridge PACS por empresa.
 * Hostname fijo: https://pacs-<clinica>.imedic.com.ar
 */
const { getTenantId } = require('../context/tenantContext');

const PACS_TOKEN = String(process.env.PACS_BRIDGE_TOKEN || process.env.FILE_SERVER_TOKEN || '').trim();

function pacsHeaders(extra) {
	const headers = { ...(extra || {}) };
	if (PACS_TOKEN) headers['x-imedic-token'] = PACS_TOKEN;
	return headers;
}

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

function isUnreachableFromCloud(url) {
	const host = hostnameOf(url);
	if (!host) return true;
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
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
		`La empresa ${id} no tiene PacsUrl. Cargá https://pacs-<clinica>.imedic.com.ar (túnel del bridge PACS).`,
	);
	err.code = 'PACS_URL_MISSING';
	return err;
}

/**
 * @param {number|string|null} [idEmpresaOpt]
 * @returns {Promise<string>}
 */
async function resolvePacsUrl(idEmpresaOpt) {
	const idRaw = idEmpresaOpt != null && idEmpresaOpt !== '' ? idEmpresaOpt : getTenantId();
	const id = Number(idRaw);

	if (Number.isFinite(id) && id > 0) {
		try {
			const { loadEmpresaConnectionRow } = require('../config/tenantDb');
			const row = await loadEmpresaConnectionRow(id);
			const fromEmpresa = pickUsableUrl(row?.PacsUrl);
			if (fromEmpresa) return fromEmpresa;
		} catch (e) {
			if (e.code === 'PACS_URL_MISSING') throw e;
			console.warn(`[pacsUrl] empresa ${id}:`, e.message);
		}
	}

	const envUrl = pickUsableUrl(process.env.PACS_BRIDGE_URL || '');
	if (envUrl) return envUrl;

	throw missingUrlError(Number.isFinite(id) ? id : '?');
}

module.exports = {
	resolvePacsUrl,
	pacsHeaders,
	normalizeBaseUrl,
	PACS_TOKEN,
};
