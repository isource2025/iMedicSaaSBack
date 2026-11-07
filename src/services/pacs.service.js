const axios = require('axios');
const { resolvePacsUrl, pacsHeaders } = require('../utils/pacsUrl');

const TIMEOUT_MS = Number(process.env.PACS_BRIDGE_TIMEOUT_MS || 60000);

async function pacsGet(pathSuffix, params) {
	const base = await resolvePacsUrl();
	const url = `${base}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
	const res = await axios.get(url, {
		params,
		headers: pacsHeaders(),
		timeout: TIMEOUT_MS,
		validateStatus: () => true,
		responseType: 'json',
	});
	if (res.status >= 400) {
		const err = new Error(res.data?.error || `PACS bridge HTTP ${res.status}`);
		err.status = res.status;
		err.code = 'PACS_BRIDGE_ERROR';
		throw err;
	}
	return res.data;
}

async function health() {
	return pacsGet('/health');
}

async function listarEstudiosPorPatientId(patientId) {
	return pacsGet('/studies', { patientId: String(patientId || '').trim() });
}

async function obtenerEstudio(studyInstanceUid) {
	return pacsGet(`/studies/${encodeURIComponent(studyInstanceUid)}`);
}

async function listarSeries(studyInstanceUid) {
	return pacsGet(`/studies/${encodeURIComponent(studyInstanceUid)}/series`);
}

async function listarArchivos(studyInstanceUid) {
	return pacsGet(`/studies/${encodeURIComponent(studyInstanceUid)}/files`);
}

/** Stream de un .dcm: devuelve axios response con responseType stream. */
async function streamArchivo(studyInstanceUid, relPath) {
	const base = await resolvePacsUrl();
	const url = `${base}/studies/${encodeURIComponent(studyInstanceUid)}/file`;
	return axios.get(url, {
		params: { path: relPath },
		headers: pacsHeaders(),
		timeout: TIMEOUT_MS,
		responseType: 'stream',
		validateStatus: () => true,
	});
}

module.exports = {
	health,
	listarEstudiosPorPatientId,
	obtenerEstudio,
	listarSeries,
	listarArchivos,
	streamArchivo,
};
