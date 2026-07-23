/**
 * Resuelve la URL del file server / túnel de adjuntos por empresa.
 * Prioridad: Empresas.FileServerUrl → FILE_SERVER_URL (env) → default histórico Vidal.
 */
const { getTenantId } = require('../context/tenantContext');

const DEFAULT_FILE_SERVER_URL = 'http://181.4.71.230:3002';

function normalizeBaseUrl(url) {
	return String(url || '')
		.trim()
		.replace(/\/+$/, '');
}

function envFileServerFallback() {
	return normalizeBaseUrl(process.env.FILE_SERVER_URL || DEFAULT_FILE_SERVER_URL);
}

/**
 * @param {number|string|null} [idEmpresaOpt]
 * @returns {Promise<string>}
 */
async function resolveFileServerUrl(idEmpresaOpt) {
	const idRaw = idEmpresaOpt != null && idEmpresaOpt !== '' ? idEmpresaOpt : getTenantId();
	const id = Number(idRaw);
	const fallback = envFileServerFallback();

	if (!Number.isFinite(id) || id <= 0) return fallback;

	try {
		const { loadEmpresaConnectionRow } = require('../config/tenantDb');
		const row = await loadEmpresaConnectionRow(id);
		const fromEmpresa = normalizeBaseUrl(row?.FileServerUrl);
		if (fromEmpresa) return fromEmpresa;
	} catch (e) {
		console.warn(`[fileServerUrl] empresa ${id}:`, e.message);
	}

	return fallback;
}

module.exports = {
	DEFAULT_FILE_SERVER_URL,
	normalizeBaseUrl,
	envFileServerFallback,
	resolveFileServerUrl,
};
