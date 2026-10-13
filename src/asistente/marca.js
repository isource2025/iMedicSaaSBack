/**
 * Marca de contenido generativo: todo texto redactado por el asistente queda
 * firmado con quién lo validó y cuándo. La identidad sale del JWT del que
 * confirma, nunca del modelo.
 */
const PREFIJO = '[IA iMedic]';
const RE_MARCA = /\n*\[IA iMedic\][^\n]*$/;

function validadorDe(req) {
	const u = req?.auth?.usuario || {};
	const nombre = [u.apellido, u.nombre].filter(Boolean).join(', ').trim() || u.username || null;
	return {
		nombre: nombre || `Personal ${req?.valorPersonal ?? '?'}`,
		matricula: req?.matricula || u.matricula || null,
		valorPersonal: req?.valorPersonal ?? null,
	};
}

function fechaHora(d = new Date()) {
	const dd = String(d.getDate()).padStart(2, '0');
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const hh = String(d.getHours()).padStart(2, '0');
	const mi = String(d.getMinutes()).padStart(2, '0');
	return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

function textoMarca(req, fecha = new Date()) {
	const v = validadorDe(req);
	const mat = v.matricula ? ` (Mat. ${v.matricula})` : '';
	return `${PREFIJO} Redactado con asistente IA · validado por ${v.nombre}${mat} el ${fechaHora(fecha)}`;
}

function tieneMarca(texto) {
	return RE_MARCA.test(String(texto || ''));
}

/** Agrega (o renueva) la marca al final del texto. */
function marcar(texto, req, fecha) {
	const base = String(texto || '').replace(RE_MARCA, '').trimEnd();
	return `${base}\n\n${textoMarca(req, fecha)}`;
}

const CAMPO_DATO =
	/fecha|hora|^id|^valor|dni|documento|cuit|cuil|matricula|codigo|^nro|numero|telefono|celular|mail|sexo|tipo|estado|apellido|nombre|domicilio|direccion|calle|localidad|ciudad|provincia|pais|cp$|postal|rol|especialidad|sector|cama|usuario/i;
const VALOR_DATO = /^\s*(\d[\d\s./:-]*|\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?|[\w.+-]+@[\w-]+\.[\w.]+)\s*$/;

/**
 * Sólo los textos redactados (evoluciones, observaciones, notas) llevan marca.
 * Fechas, números, identidad y catálogos son datos: pegarles la marca los rompe.
 */
function esTextoLibre(campo, valor) {
	if (typeof valor !== 'string' || !valor.trim()) return false;
	if (CAMPO_DATO.test(String(campo || ''))) return false;
	if (VALOR_DATO.test(valor)) return false;
	return /\s/.test(valor.trim()) || valor.trim().length >= 25;
}

/** De los campos que el modelo dice haber redactado, los que realmente son texto libre. */
function camposMarcables(body, campos) {
	if (!body || typeof body !== 'object' || !Array.isArray(campos)) return [];
	return [...new Set(campos.map(String))].filter((c) => esTextoLibre(c, body[c]));
}

/** Marca los campos de texto libre indicados de un body (copia). */
function marcarBody(body, campos, req, fecha) {
	const marcables = camposMarcables(body, campos);
	if (!marcables.length) return body;
	const out = { ...body };
	for (const c of marcables) out[c] = marcar(out[c], req, fecha);
	return out;
}

module.exports = {
	PREFIJO,
	validadorDe,
	textoMarca,
	tieneMarca,
	marcar,
	marcarBody,
	camposMarcables,
	esTextoLibre,
	fechaHora,
};
