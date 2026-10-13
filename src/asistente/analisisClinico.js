/**
 * Análisis clínico como copiloto:
 * - COMO_RESPONDER: síntesis, tendencias, alertas y sugerencias, no un listado de registros.
 *   Viaja en el resultado de las tools de análisis y no en el prompt: solo cuando hay datos que
 *   analizar. Los títulos ## los usa el chat para armar secciones. No cuenta para los topes de
 *   lectura: es instrucción, no datos.
 * - signosDeEvoluciones: los signos que el médico escribe en cada evolución, en serie y con lo
 *   fuera de rango calculado (el modelo no arma bien la trayectoria leyendo los textos).
 */
const COMO_RESPONDER = [
	'Si pidió análisis, resumen o «cómo está/sigue»: respondé como copiloto clínico, no como listado. Markdown con estos ## en orden:',
	'## Síntesis: 2-3 oraciones: quién, por qué está internado, día de internación, hacia dónde va (mejora/estable/empeora/sin datos recientes) y el hallazgo que más pesa.',
	'## Tendencias: UNA tabla | Parámetro | Evolución | Lectura | con UNA fila por parámetro (no por fecha), de 3 a 7 filas, solo los que tienen datos (TA, FC, T°, Sat, glucemias, balance, herida…). Evolución: del más viejo al más reciente, ej. «130/80 (20/02) → 110/70 (22/02)» o el rango. Lectura: qué significa («en rango», «HGT >180 el DD/MM», «en aumento»). Cada valor con la fecha de SU registro. Armala con la fuente que pidió: controles / signos de enfermería → la tendencia de signos_vitales; evoluciones → signosEnEvoluciones.',
	'## Alertas: de mayor a menor, una por línea, con dato y fecha (fuera de rango, infección, balance muy positivo, registros que faltan o se contradicen). Si no hay: «Sin alertas en los registros.»',
	'«Fuera de rango», «hipo/hiperglucemia», «fiebre»: solo según fueraDeRango y el criterio que traen las tools; no lo recalcules.',
	'## Para considerar: 2 a 5 sugerencias tuyas para el equipo tratante, cada una atada a un hallazgo (qué revisar, vigilar, qué estudio o interconsulta evaluar). Sin dosis ni medicación nueva; no digas que están registradas.',
	'No repitas registro por registro lo de la tabla. Solo si pidió el detalle: al final ## Detalle, una línea por registro.',
].join('\n');

const RANGOS = Object.freeze({ TAS: [90, 139], FC: [50, 110], FR: [10, 24], T: [35.5, 37.7], Sat: [94, null], HGT: [70, 180] });
const CRITERIO = 'Fuera de rango: TAS <90 o >139, FC <50 o >110, FR <10 o >24, T <35.5 o >37.7, Sat <94, HGT <70 o >180.';

const PATRONES = [
	['TA', /\bT\.?\s?A\.?\s*:?\s*(\d{2,3})\s*\/\s*(\d{2,3})/i, (m) => `${m[1]}/${m[2]}`],
	['FC', /\bF\.?\s?C\.?\s*:?\s*(\d{2,3})\b/i, (m) => Number(m[1])],
	['FR', /\bF\.?\s?R\.?\s*:?\s*(\d{1,2})\b/i, (m) => Number(m[1])],
	['T', /\bT(?:°|º|EMP\w*\.?)\s*:?\s*(\d{2}(?:[.,]\d)?)/i, (m) => Number(m[1].replace(',', '.'))],
	['Sat', /\bSAT\w*\s*:?\s*(\d{2,3})\s*%/i, (m) => Number(m[1])],
	['Glucemias', /\bGLUCEMIAS?\s*:?\s*(\d{2,3}(?:\s*[-/,y]\s*\d{2,3})*)/i, (m) => m[1].replace(/\s+/g, '')],
	['Diuresis', /\bDIURESIS\s*:?\s*(\d{2,5})\b/i, (m) => Number(m[1])],
	['Balance', /\bBALANCE\s*:?\s*(NEUTRO|[+-]?\s*\d{1,5})/i, (m) => m[1].replace(/\s+/g, '').toUpperCase()],
];

function signosDeTexto(texto) {
	const t = String(texto || '');
	const out = {};
	for (const [clave, re, valor] of PATRONES) {
		const m = t.match(re);
		if (m) out[clave] = valor(m);
	}
	return out;
}

function fuera(clave, v) {
	const [min, max] = RANGOS[clave];
	return (min != null && v < min) || (max != null && v > max);
}

/**
 * filas: evoluciones con el texto completo, la más reciente primero (como las devuelve la API).
 * Devuelve la serie de la más vieja a la más reciente y lo fuera de rango con su fecha, o undefined
 * si no hay al menos 2 evoluciones con signos escritos.
 */
function signosDeEvoluciones(filas, fechaDe) {
	const serie = [];
	for (const f of [...filas].reverse()) {
		const s = signosDeTexto(f.Evolucion);
		if (Object.keys(s).length >= 2) serie.push({ fecha: fechaDe ? fechaDe(f) : f.FechaEv, ...s });
	}
	if (serie.length < 2) return undefined;
	const fueraDeRango = [];
	for (const s of serie) {
		const dia = String(s.fecha).slice(0, 10);
		const tas = s.TA ? Number(String(s.TA).split('/')[0]) : null;
		if (tas != null && fuera('TAS', tas)) fueraDeRango.push(`TA ${s.TA} (${dia})`);
		for (const k of ['FC', 'FR', 'T', 'Sat']) if (s[k] != null && fuera(k, s[k])) fueraDeRango.push(`${k} ${s[k]} (${dia})`);
		const hgt = String(s.Glucemias || '').split(/[-/,y]/).map(Number).filter((n) => n >= 20 && n <= 1500);
		const malas = hgt.filter((n) => fuera('HGT', n));
		if (malas.length) fueraDeRango.push(`HGT ${malas.join(', ')} (${dia})`);
	}
	return {
		nota: 'Signos que escribió el médico en cada evolución, de la más vieja a la más reciente. Para controles de enfermería, la tendencia de signos_vitales.',
		serie,
		fueraDeRango: fueraDeRango.length ? fueraDeRango : ['ninguno'],
		criterio: CRITERIO,
	};
}

module.exports = { COMO_RESPONDER, signosDeEvoluciones, signosDeTexto };
