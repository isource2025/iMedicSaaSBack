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

function visitaCubreFecha(visita, studyDateYmd) {
	const f = ymd(studyDateYmd);
	const d = ymd(visita?.desde);
	if (!f || !d) return false;
	const h = ymd(visita?.hasta);
	return f >= d && (!h || f <= h);
}

/**
 * Entre las visitas del paciente que cubren la fecha del estudio, elige la más
 * actual (el arreglo debe venir ordenado: ingreso más reciente primero).
 * El tomógrafo exporta DNI + fecha; si hay dos visitas el mismo día para el
 * mismo paciente, el estudio queda en la más reciente.
 */
function visitaDueniaDelEstudio(studyDate, visitasPaciente) {
	const f = ymd(studyDate);
	if (!f || !Array.isArray(visitasPaciente) || !visitasPaciente.length) return null;
	return visitasPaciente.find((v) => visitaCubreFecha(v, f)) || null;
}

/**
 * Estudios de una visita: AccessionNumber = NumeroVisita (exacto) o, si no hay
 * accession numérico, fecha del estudio dentro de [ingreso, egreso || hoy].
 *
 * Con `visitasPaciente` (todas las visitas del DNI, más reciente primero), un
 * estudio por fecha solo se asigna a la visita dueña: evita que dos visitas
 * del mismo día muestren el mismo estudio del tomógrafo.
 */
function filtrarEstudiosDeVisita(studies, { numeroVisita, desde, hasta, visitasPaciente }) {
	const nv = String(numeroVisita);
	const d = ymd(desde);
	const h = ymd(hasta);
	return (studies || []).filter((s) => {
		const acc = String(s.accessionNumber || '').replace(/\D/g, '');
		if (acc) return acc === nv;
		const f = ymd(s.studyDate);
		if (!f || !d) return false;
		if (!(f >= d && (!h || f <= h))) return false;
		if (!Array.isArray(visitasPaciente) || !visitasPaciente.length) return true;
		const duenia = visitaDueniaDelEstudio(f, visitasPaciente);
		return duenia != null && String(duenia.numeroVisita) === nv;
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
			v.IdPaciente,
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
	const hoy = new Date().toISOString().slice(0, 10);
	const desde = visita.FechaAdmision || null;
	const hasta = visita.FechaEgreso || hoy;
	const base = { numeroVisita: nv, documento, desde, hasta, egresada: Boolean(visita.FechaEgreso) };
	if (!documento) return { ...base, count: 0, studies: [] };

	const idPaciente = Number(visita.IdPaciente);
	let visitasPaciente = [{ numeroVisita: nv, desde, hasta }];
	if (Number.isFinite(idPaciente) && idPaciente > 0) {
		const hermanas = await executeQuery(
			`
			SELECT
				v.NumeroVisita,
				CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
				CASE
					WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL AND TRY_CAST(v.FechaEgreso AS int) > 0
					THEN CONVERT(VARCHAR(10), dbo.fn_ClarionDATE2SQL(v.FechaEgreso), 23)
					ELSE NULL
				END AS FechaEgreso
			FROM imVisita v
			WHERE v.IdPaciente = @param0
			ORDER BY v.FECHAADMISIONS DESC, v.NumeroVisita DESC
			`,
			[{ value: idPaciente }],
		);
		visitasPaciente = (hermanas || []).map((r) => ({
			numeroVisita: Number(r.NumeroVisita),
			desde: r.FechaAdmision || null,
			hasta: r.FechaEgreso || hoy,
		}));
	}

	const data = await listarEstudiosPorPatientId(documento);
	const studies = filtrarEstudiosDeVisita(data?.studies, {
		numeroVisita: nv,
		desde,
		hasta,
		visitasPaciente,
	});
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
	visitaDueniaDelEstudio,
	obtenerEstudio,
	listarSeries,
	listarArchivos,
	streamArchivo,
};
