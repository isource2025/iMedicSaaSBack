/**
 * Autoría de registros clínicos para el asistente, con la misma regla que
 * `requirePropietario`: el modelo sabe qué registros son del usuario y no
 * ofrece modificar/borrar los ajenos.
 */
const { verificarPropiedad, esAdminClinico, coincideAutor } = require('../middlewares/propietario.middleware');
const manifiesto = require('./manifiesto');

/** Columnas donde las tablas clínicas guardan al autor (CodOperador, matrícula o ValorPersonal). */
const CLAVES_AUTOR = /^(operadorcarga|profecional|profesional|idprofesional|operadorcargaid|codoperador)$/i;

function identidad(req) {
	const u = req?.auth?.usuario || {};
	return {
		nombre: [u.apellido, u.nombre].filter(Boolean).join(', ') || u.username || null,
		valorPersonal: req?.valorPersonal ?? null,
		matricula: req?.matricula ?? u.matricula ?? null,
		codOperador: u.codOperador ?? null,
	};
}

async function esAdmin(req) {
	if (!req) return false;
	if (req._asistenteEsAdmin === undefined) {
		try {
			req._asistenteEsAdmin = await esAdminClinico(req);
		} catch {
			req._asistenteEsAdmin = false;
		}
	}
	return req._asistenteEsAdmin;
}

function esNumerico(v) {
	return v != null && v !== '' && Number.isFinite(Number(v));
}

function esPropio(obj, req) {
	let vio = false;
	for (const [k, v] of Object.entries(obj)) {
		if (!CLAVES_AUTOR.test(k) || !esNumerico(v)) continue;
		vio = true;
		const porMatricula = /profecional|profesional/i.test(k);
		if (coincideAutor(v, porMatricula ? (req?.matricula ?? null) : null, req)) return true;
	}
	return vio ? false : undefined;
}

/** Agrega `_propio` a cada registro que tenga columna de autor. */
function anotar(valor, req, prof = 0) {
	if (!valor || typeof valor !== 'object' || prof > 4) return valor;
	if (Array.isArray(valor)) {
		for (const it of valor) anotar(it, req, prof + 1);
		return valor;
	}
	const p = esPropio(valor, req);
	if (p !== undefined) valor._propio = p;
	for (const v of Object.values(valor)) {
		if (v && typeof v === 'object') anotar(v, req, prof + 1);
	}
	return valor;
}

/** Pre-chequeo de un PUT/PATCH/DELETE sobre un endpoint con requirePropietario. */
async function verificar(ep, pathConcreto, req) {
	if (!ep?.propietario) return { ok: true };
	const params = manifiesto.paramsDe(ep, pathConcreto);
	return verificarPropiedad(req, ep.propietario, params[ep.propietario.pkParam]);
}

module.exports = { identidad, esAdmin, anotar, verificar, CLAVES_AUTOR };
