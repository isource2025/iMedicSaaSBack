/**
 * Prefijos de práctica por servicio (imServicios.PrefijosPractica).
 *
 * Un "prefijo" es el CAPÍTULO del nomenclador: el código de práctica se arma como
 *   IDPractica = Valor * 10000 + SubValor * 100 + Practica
 * (imNomenclador.Valor / imModuladas.Valor, p. ej. 66 = bioquímica, 34 = rayos, 18 = ecografía).
 * Por eso un prefijo se compara con IDPractica / 10000 (numérico), no con el texto del código.
 *
 * En la base se guarda como lista separada por comas ("42,66,87"). El 42 (consultas /
 * interconsulta) está en casi todos los servicios a propósito.
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');

const COLUMNA = 'PrefijosPractica';
const LARGO_COLUMNA = 40;

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

/** Capítulo (prefijo) de un código de práctica; 0 si el código no tiene capítulo. */
function capituloDe(codPractica) {
	const n = Math.trunc(Number(codPractica));
	if (!Number.isFinite(n) || n < 10000) return 0;
	return Math.floor(n / 10000);
}

/** "42, 66,87" -> ['42','66','87'] (únicos, numéricos, ordenados). Ignora lo que no sea número. */
function parsear(texto) {
	const lista = Array.isArray(texto) ? texto : String(texto ?? '').split(',');
	const out = new Set();
	for (const raw of lista) {
		const t = String(raw ?? '').trim();
		if (!/^\d{1,3}$/.test(t)) continue;
		const n = Number(t);
		if (n > 0) out.add(n);
	}
	return Array.from(out)
		.sort((a, b) => a - b)
		.map(String);
}

/** ['66','42'] -> "42,66" (formato de la columna). */
function formatear(prefijos) {
	return parsear(prefijos).join(',');
}

const _limpiar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Todos los capítulos que existen: imNomenclador.Valor ∪ imModuladas.Valor, con una descripción
 * de ayuda (imSubTipoPractica si está cargada, si no una práctica de ejemplo) y cuántas prácticas
 * hay en cada catálogo y cuántos estudios ya están cargados para pedidos (imTiposPedidosEstudios).
 */
async function listarOpciones() {
	// Una consulta por vez (el pool puede estar abriéndose). Los conteos de nomenclador y moduladas son
	// obligatorios: si fallan, el error sale en vez de mostrar una lista incompleta. Las ayudas
	// (ejemplos, descripciones, estudios cargados) son opcionales y pueden no existir en la base.
	let cola = Promise.resolve();
	const cuentas = (sqlTexto, obligatorio = false) => {
		const p = cola.then(async () => {
			try {
				return (await executeQuery(sqlTexto)) || [];
			} catch (err) {
				if (obligatorio) throw err;
				return [];
			}
		});
		cola = p.catch(() => {});
		return p;
	};
	const [nom, mod, ped, ejNom, ejMod, sub] = await Promise.all([
		cuentas(`SELECT CAST(Valor AS INT) AS valor, COUNT(*) AS n FROM dbo.imNomenclador WHERE Valor > 0 GROUP BY Valor`, true),
		cuentas(`SELECT CAST(Valor AS INT) AS valor, COUNT(*) AS n FROM dbo.imModuladas WHERE Valor > 0 GROUP BY Valor`, true),
		cuentas(
			`SELECT IdPractica / 10000 AS valor, COUNT(*) AS n FROM dbo.imTiposPedidosEstudios
			 WHERE IdPractica >= 10000 AND (IdTipoPedido IS NULL OR IdTipoPedido <> 33)
			 GROUP BY IdPractica / 10000`,
		),
		cuentas(
			`SELECT valor, descripcion FROM (
				SELECT CAST(Valor AS INT) AS valor, LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(80)))) AS descripcion,
				       ROW_NUMBER() OVER (PARTITION BY Valor ORDER BY SubValor, Practica) AS rn
				FROM dbo.imNomenclador WHERE Valor > 0) x WHERE rn = 1`,
		),
		cuentas(
			`SELECT valor, descripcion FROM (
				SELECT CAST(Valor AS INT) AS valor, LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(80)))) AS descripcion,
				       ROW_NUMBER() OVER (PARTITION BY Valor ORDER BY SubValor, Practica) AS rn
				FROM dbo.imModuladas WHERE Valor > 0) x WHERE rn = 1`,
		),
		cuentas(
			`SELECT CAST(Valor AS INT) AS valor, LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(80)))) AS descripcion
			 FROM dbo.imSubTipoPractica WHERE SubValor = 0 AND LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(80)))) <> ''`,
		),
	]);

	const mapa = (rows, campo) => new Map(rows.map((r) => [Number(r.valor), campo ? r[campo] : Number(r.n) || 0]));
	const nNom = mapa(nom);
	const nMod = mapa(mod);
	const nPed = mapa(ped);
	const eNom = mapa(ejNom, 'descripcion');
	const eMod = mapa(ejMod, 'descripcion');
	const dSub = mapa(sub, 'descripcion');

	const valores = new Set([...nNom.keys(), ...nMod.keys(), ...nPed.keys()]);
	return Array.from(valores)
		.filter((v) => v > 0)
		.sort((a, b) => a - b)
		.map((v) => {
			const cNom = nNom.get(v) || 0;
			const cMod = nMod.get(v) || 0;
			const cPed = nPed.get(v) || 0;
			// El ejemplo sale del catálogo donde el capítulo tiene más prácticas.
			const ejemplo = _limpiar(dSub.get(v) || (cNom >= cMod ? eNom.get(v) || eMod.get(v) : eMod.get(v) || eNom.get(v)));
			const partes = [];
			if (cNom) partes.push(`${cNom} en nomenclador`);
			if (cMod) partes.push(`${cMod} en moduladas`);
			partes.push(cPed ? `${cPed} cargadas para pedir` : 'ninguna cargada para pedir');
			return {
				value: String(v),
				label: ejemplo ? `${v} · ${ejemplo}` : String(v),
				detail: partes.join(' · '),
			};
		});
}

/**
 * Valida y normaliza una lista de prefijos antes de guardarla.
 * @param {string|string[]} entrada
 * @param {{ permitidosExtra?: string[] }} [opts] valores ya guardados que se toleran aunque ya no existan
 * @returns {Promise<string>} texto para la columna ("42,66,87")
 */
async function validarYFormatear(entrada, { permitidosExtra = [], largoMax = LARGO_COLUMNA } = {}) {
	const pedidos = parsear(entrada);
	if (pedidos.length) {
		const validos = new Set((await listarOpciones()).map((o) => o.value));
		for (const p of parsear(permitidosExtra)) validos.add(p);
		const invalidos = pedidos.filter((p) => !validos.has(p));
		if (invalidos.length) {
			throw _httpError(`Prefijo no válido: ${invalidos.join(', ')}`);
		}
	}
	const texto = pedidos.join(',');
	if (texto.length > largoMax) {
		throw _httpError(`Demasiados prefijos: no entran en la columna (máximo ${largoMax} caracteres).`);
	}
	return texto;
}

/* ---- Prefijos de un servicio (usado para filtrar el catálogo de estudios) ---- */

const TTL_MS = 10 * 60 * 1000;
const _cache = new Map();
// El historial solo cuenta si el capítulo es relevante para el servicio (evita arrastrar pedidos mal cargados).
const HIST_MIN_PEDIDOS = 10;
const HIST_MIN_PROPORCION = 0.05;

function limpiarCache() {
	_cache.clear();
}

/**
 * Capítulos que corresponden a un servicio:
 *  - los configurados en imServicios.PrefijosPractica, más
 *  - los que ese servicio recibe de verdad en el historial (>= 10 pedidos y >= 5% de los suyos).
 * Devuelve [] si no se puede determinar. Valores numéricos.
 */
async function prefijosDeServicio(servicio) {
	const code = String(servicio || '').trim();
	if (!code) return [];
	const key = `${getTenantId() ?? 'default'}|${code.toUpperCase()}`;
	const hit = _cache.get(key);
	if (hit && hit.exp > Date.now()) return hit.prefijos;

	const set = new Set();
	try {
		const rows = await executeQuery(
			`SELECT RTRIM(LTRIM(ISNULL(CAST(${COLUMNA} AS VARCHAR(200)), ''))) AS pref
			 FROM dbo.imServicios WHERE RTRIM(LTRIM(Valor)) = @p0`,
			[{ value: code, type: 'VarChar' }],
		);
		for (const r of rows || []) for (const p of parsear(r.pref)) set.add(Number(p));
	} catch {
		/* sin imServicios.PrefijosPractica */
	}
	try {
		const est = require('./estudios.service');
		const rows = await executeQuery(
			`SELECT IdPractica / 10000 AS capitulo, COUNT(*) AS n
			 FROM dbo.imPedidosEstudios
			 WHERE IdSectorReceptor = @p0 AND IdPractica >= 10000
			 GROUP BY IdPractica / 10000`,
			[{ value: est._padSector(code), type: 'VarChar' }],
		);
		const total = (rows || []).reduce((n, r) => n + (Number(r.n) || 0), 0);
		for (const r of rows || []) {
			const n = Number(r.n) || 0;
			if (n >= HIST_MIN_PEDIDOS && total > 0 && n / total >= HIST_MIN_PROPORCION) {
				set.add(Number(r.capitulo));
			}
		}
	} catch {
		/* sin historial */
	}
	const prefijos = Array.from(set)
		.filter((n) => Number.isFinite(n) && n > 0)
		.sort((a, b) => a - b);
	_cache.set(key, { exp: Date.now() + TTL_MS, prefijos });
	return prefijos;
}

/* ---- Super admin: lectura y escritura sobre la base del tenant actual ---- */

/** Servicios del tenant con sus prefijos configurados (solo lo guardado, sin historial). */
async function listarServicios() {
	let rows;
	try {
		rows = await executeQuery(
			`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor,
			        RTRIM(LTRIM(CAST(ISNULL(Descripcion, '') AS VARCHAR(200)))) AS descripcion,
			        RTRIM(LTRIM(ISNULL(CAST(${COLUMNA} AS VARCHAR(200)), ''))) AS prefijos
			 FROM dbo.imServicios WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> '' ORDER BY Descripcion`,
		);
	} catch {
		rows = await executeQuery(
			`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor,
			        RTRIM(LTRIM(CAST(ISNULL(Descripcion, '') AS VARCHAR(200)))) AS descripcion,
			        '' AS prefijos
			 FROM dbo.imServicios WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> '' ORDER BY Descripcion`,
		);
	}
	return (rows || []).map((r) => ({
		id: String(r.valor || '').trim(),
		descripcion: String(r.descripcion || '').trim(),
		prefijos: parsear(r.prefijos),
	}));
}

/** La columna es aditiva y nullable: si el tenant no la tiene, se agrega. */
async function asegurarColumna() {
	await executeQuery(
		`IF COL_LENGTH(N'dbo.imServicios', N'${COLUMNA}') IS NULL
		   ALTER TABLE dbo.imServicios ADD ${COLUMNA} VARCHAR(${LARGO_COLUMNA}) NULL`,
	);
}

async function guardarServicio(valor, prefijos) {
	const id = String(valor || '').trim();
	if (!id) throw _httpError('Servicio inválido');
	const existentes = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(Valor)) AS valor FROM dbo.imServicios WHERE RTRIM(LTRIM(Valor)) = @p0`,
		[{ value: id, type: 'VarChar' }],
	);
	if (!existentes?.length) throw _httpError(`El servicio ${id} no existe`, 404);
	await asegurarColumna();
	const previos = await executeQuery(
		`SELECT RTRIM(LTRIM(ISNULL(CAST(${COLUMNA} AS VARCHAR(200)), ''))) AS pref
		 FROM dbo.imServicios WHERE RTRIM(LTRIM(Valor)) = @p0`,
		[{ value: id, type: 'VarChar' }],
	);
	const texto = await validarYFormatear(prefijos, { permitidosExtra: parsear(previos?.[0]?.pref) });
	await executeQuery(
		`UPDATE dbo.imServicios SET ${COLUMNA} = @p1 WHERE RTRIM(LTRIM(Valor)) = @p0`,
		[
			{ value: id, type: 'VarChar' },
			{ value: texto, type: 'VarChar', length: LARGO_COLUMNA },
		],
	);
	limpiarCache();
	return { id, prefijos: parsear(texto), texto };
}

module.exports = {
	COLUMNA,
	LARGO_COLUMNA,
	capituloDe,
	parsear,
	formatear,
	listarOpciones,
	validarYFormatear,
	prefijosDeServicio,
	limpiarCache,
	listarServicios,
	guardarServicio,
};
