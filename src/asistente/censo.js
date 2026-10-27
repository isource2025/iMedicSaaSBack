/**
 * Censo de internados (camas ocupadas) por empresa, en memoria por unos segundos.
 * Una sola query alimenta la búsqueda por nombre (con errores de tipeo), las listas
 * por sector y el pase de guardia: no se va a la base en cada pregunta.
 */
const { executeQuery } = require('../models/db');

const TTL_MS = Number(process.env.ASISTENTE_CENSO_TTL_MS) || 60 * 1000;
const MAX_FILAS = 2000;
const cache = new Map();

const SQL_CENSO = `
    /* asistente:censo */
    SELECT TOP ${MAX_FILAS}
      v.NumeroVisita AS numeroVisita,
      v.IdPaciente AS idPaciente,
      LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS paciente,
      LTRIM(RTRIM(ISNULL(p.NumeroDocumento, ''))) AS documento,
      p.NumeroHC AS hc,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) AS ingreso,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS ingresoIso,
      LTRIM(RTRIM(ISNULL(d.Descripcion, ISNULL(v.Diagnostico, '')))) AS diagnostico,
      LTRIM(RTRIM(hc.ValorSector)) AS sector,
      LTRIM(RTRIM(s.Descripcion)) AS sectorDescripcion,
      LTRIM(RTRIM(hc.ValorHabitacionCama)) AS cama
    FROM dbo.imHabitacionCamas hc
    INNER JOIN dbo.imVisita v ON v.NumeroVisita = hc.NumeroVisita AND TRY_CAST(hc.NumeroVisita AS int) > 0
    INNER JOIN dbo.imPacientes p ON p.IdPaciente = v.IdPaciente
    LEFT JOIN dbo.imSectores s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(hc.ValorSector))
    LEFT JOIN dbo.imDiagnosticos d ON LTRIM(RTRIM(d.CodigoOMS)) = LTRIM(RTRIM(CAST(v.Diagnostico AS varchar(20))))
    WHERE ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) = 0
    `;

function normalizar(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function fila(r) {
	return {
		numeroVisita: Number(r.numeroVisita),
		idPaciente: r.idPaciente || null,
		paciente: r.paciente || null,
		documento: String(r.documento || '').trim() || null,
		hc: String(r.hc ?? '').trim() || null,
		ingreso: r.ingreso || null,
		ingresoIso: r.ingresoIso || null,
		diagnostico: r.diagnostico ? String(r.diagnostico).trim() : null,
		sector: r.sector ? String(r.sector).trim() : null,
		sectorDescripcion: r.sectorDescripcion ? String(r.sectorDescripcion).trim() : null,
		cama: r.cama ? String(r.cama).trim() : null,
		egresada: false,
		_palabras: normalizar(r.paciente).split(' ').filter(Boolean),
	};
}

/** Lista de internados activos de la empresa del pedido (cacheada TTL_MS). */
async function obtener(idEmpresa, { forzar = false } = {}) {
	const clave = Number(idEmpresa) || 0;
	const previo = cache.get(clave);
	if (!forzar && previo && Date.now() - previo.ts < TTL_MS) return previo.filas;
	if (previo?.cargando) return previo.cargando;
	const cargando = executeQuery(SQL_CENSO, [])
		.then((rows) => {
			const filas = (rows || []).map(fila).filter((f) => Number.isFinite(f.numeroVisita) && f.numeroVisita > 0);
			cache.set(clave, { ts: Date.now(), filas });
			return filas;
		})
		.catch((err) => {
			cache.delete(clave);
			throw err;
		});
	cache.set(clave, { ...(previo || {}), ts: previo?.ts || 0, filas: previo?.filas, cargando });
	return cargando;
}

/** Después de un egreso / traslado confirmado el censo cambió. */
function invalidar(idEmpresa) {
	if (idEmpresa == null) cache.clear();
	else cache.delete(Number(idEmpresa) || 0);
}

function levenshtein(a, b, tope) {
	if (Math.abs(a.length - b.length) > tope) return tope + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		let min = i;
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (cur[j] < min) min = cur[j];
		}
		if (min > tope) return tope + 1;
		prev = cur;
	}
	return prev[b.length];
}

/** 2 = la palabra contiene el término; 1 = un error de tipeo; 0 = no coincide. */
function puntajePalabra(t, palabras) {
	if (palabras.some((w) => w.includes(t))) return 2;
	if (t.length < 4) return 0;
	const tope = t.length >= 7 ? 2 : 1;
	return palabras.some((w) => levenshtein(t, w, tope) <= tope || (w.length > t.length && levenshtein(t, w.slice(0, t.length), tope) <= tope)) ? 1 : 0;
}

/**
 * Busca en el censo por claves de clinica.extraerClavesBusqueda.
 * Devuelve { exactos, aproximados }: exactos son los que contienen todos los términos.
 */
function buscar(filas, claves) {
	const exactos = [];
	const aproximados = [];
	for (const f of filas || []) {
		if (claves.dni && f.documento === claves.dni) {
			exactos.push(f);
			continue;
		}
		if (claves.numeroVisita && f.numeroVisita === claves.numeroVisita) {
			exactos.push(f);
			continue;
		}
		if (claves.cama) {
			// Con cama, las palabras que acompañan son el sector («la 3 de UTI»), no el nombre.
			const sector = normalizar(`${f.sector || ''} ${f.sectorDescripcion || ''}`);
			const enSector = (claves.tokens || []).every((t) => sector.includes(normalizar(t)));
			if (enSector && normalizar(f.cama).replace(/^0+(?=\d)/, '') === claves.cama) exactos.push(f);
			continue;
		}
		if (!claves.tokens?.length) continue;
		const puntos = claves.tokens.map((t) => puntajePalabra(normalizar(t), f._palabras));
		if (puntos.some((p) => p === 0)) continue;
		if (puntos.every((p) => p === 2)) exactos.push(f);
		else aproximados.push({ f, puntos: puntos.reduce((s, p) => s + p, 0) });
	}
	aproximados.sort((a, b) => b.puntos - a.puntos);
	return { exactos, aproximados: aproximados.slice(0, 5).map((x) => x.f) };
}

/** Sector por código o nombre («UTI», «clínica médica 1», «qur2»). */
function filtrarSector(filas, sector) {
	const q = normalizar(sector);
	if (!q) return filas;
	const exacto = filas.filter((f) => normalizar(f.sector) === q || normalizar(f.sectorDescripcion) === q);
	if (exacto.length) return exacto;
	return filas.filter((f) => normalizar(f.sectorDescripcion).includes(q) || normalizar(f.sector).startsWith(q));
}

function sectores(filas) {
	const m = new Map();
	for (const f of filas) {
		const k = f.sector || '—';
		if (!m.has(k)) m.set(k, { sector: k, descripcion: f.sectorDescripcion || k, internados: 0 });
		m.get(k).internados += 1;
	}
	return [...m.values()].sort((a, b) => b.internados - a.internados);
}

function publica(f) {
	if (!f) return f;
	const { _palabras, ...resto } = f;
	return resto;
}

function _reset() {
	cache.clear();
}

module.exports = { obtener, invalidar, buscar, filtrarSector, sectores, publica, normalizar, levenshtein, SQL_CENSO, _reset };
