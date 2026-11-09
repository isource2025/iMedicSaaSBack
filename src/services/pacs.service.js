const axios = require('axios');
const { executeQuery } = require('../models/db');
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

function ymd(v) {
	const s = String(v || '').trim();
	const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
	return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

/**
 * Estudios de una visita: AccessionNumber = NumeroVisita (exacto) o, si no hay
 * accession numérico, fecha del estudio dentro de [ingreso, egreso || hoy].
 */
function filtrarEstudiosDeVisita(studies, { numeroVisita, desde, hasta }) {
	const nv = String(numeroVisita);
	const d = ymd(desde);
	const h = ymd(hasta);
	return (studies || []).filter((s) => {
		const acc = String(s.accessionNumber || '').replace(/\D/g, '');
		if (acc) return acc === nv;
		const f = ymd(s.studyDate);
		if (!f || !d) return false;
		return f >= d && (!h || f <= h);
	});
}

async function listarEstudiosPorVisita(numeroVisita) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) {
		const err = new Error('Número de visita inválido');
		err.status = 400;
		throw err;
	}
	const rows = await executeQuery(
		`
		SELECT TOP 1
			v.NumeroVisita,
			p.NumeroDocumento,
			CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
			CASE
				WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL AND TRY_CAST(v.FechaEgreso AS int) > 0
				THEN CONVERT(VARCHAR(10), dbo.fn_ClarionDATE2SQL(v.FechaEgreso), 23)
				ELSE NULL
			END AS FechaEgreso
		FROM imVisita v
		INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
		WHERE v.NumeroVisita = @param0
		`,
		[{ value: nv }],
	);
	const visita = rows?.[0];
	if (!visita) {
		const err = new Error('Visita no encontrada');
		err.status = 404;
		throw err;
	}
	const documento = String(visita.NumeroDocumento || '').replace(/\D/g, '');
	const desde = visita.FechaAdmision || null;
	const hasta = visita.FechaEgreso || new Date().toISOString().slice(0, 10);
	const base = { numeroVisita: nv, documento, desde, hasta, egresada: Boolean(visita.FechaEgreso) };
	if (!documento) return { ...base, count: 0, studies: [] };

	const data = await listarEstudiosPorPatientId(documento);
	const studies = filtrarEstudiosDeVisita(data?.studies, { numeroVisita: nv, desde, hasta });
	return { ...base, count: studies.length, studies };
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
	listarEstudiosPorVisita,
	filtrarEstudiosDeVisita,
	obtenerEstudio,
	listarSeries,
	listarArchivos,
	streamArchivo,
};
