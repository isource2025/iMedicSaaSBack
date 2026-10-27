/**
 * Fechas para el modelo en formato argentino (23/02/2026 21:30). Con ISO (2026-02-23) el
 * modelo las pasaba a palabras y a veces cambiaba el mes por el de hoy («23 de octubre»).
 * Los links y rutas no se tocan: el front los usa tal cual.
 */

const ISO = /(^|[^\w/=?&.-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w-])/g;
const CLAVE_RUTA = /^(link|links|url|href|path|ruta|query)$/i;
const ES_RUTA = /^\s*(\/|https?:\/\/)/i;

function aArgentina(texto) {
	return texto.replace(ISO, (_, antes, a, m, d, hh, mm) => `${antes}${d}/${m}/${a}${hh ? ` ${hh}:${mm}` : ''}`);
}

function paraModelo(valor, prof = 0) {
	if (typeof valor === 'string') return ES_RUTA.test(valor) ? valor : aArgentina(valor);
	if (!valor || typeof valor !== 'object' || prof > 8) return valor;
	if (Array.isArray(valor)) return valor.map((v) => paraModelo(v, prof + 1));
	const out = {};
	for (const [k, v] of Object.entries(valor)) out[k] = CLAVE_RUTA.test(k) ? v : paraModelo(v, prof + 1);
	return out;
}

/** «23/02/2026» (o ISO) → «2026-02-23»; null si no es una fecha. */
function aIso(f) {
	if (typeof f !== 'string') return null;
	const t = f.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
	const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!m) return null;
	const [, d, mes, a] = m;
	if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return null;
	return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

module.exports = { paraModelo, aArgentina, aIso };
