/**
 * Identidad clínica desde JWT (no confiar en campos del body).
 */
function resolveCodOperador(req) {
	const u = req.auth?.usuario || {};
	const candidates = [u.codOperador, u.idCodOperador, u.CodOperador, req.codOperador];
	for (const c of candidates) {
		if (c == null || c === '') continue;
		const n = Number(c);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

function resolveMatricula(req) {
	const u = req.auth?.usuario || {};
	const candidates = [req.matricula, u.matricula, u.Matricula];
	for (const c of candidates) {
		if (c == null || c === '') continue;
		const n = Number(c);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

/** CodOperador para OperadorCarga en tablas legacy. */
function resolveOperadorCarga(req) {
	return resolveCodOperador(req);
}

/** Matrícula profesional; si no hay, usa CodOperador (enfermería / admin). */
function resolveProfesional(req) {
	return resolveMatricula(req) ?? resolveCodOperador(req);
}

function requireOperadorCarga(req, res) {
	const op = resolveOperadorCarga(req);
	if (op == null || !Number.isFinite(op) || op <= 0) {
		res.status(400).json({
			success: false,
			mensaje: 'Sesión sin CodOperador — no se puede registrar la acción clínica',
		});
		return null;
	}
	return op;
}

function requireProfesional(req, res) {
	const p = resolveProfesional(req);
	if (p == null || !Number.isFinite(p) || p <= 0) {
		res.status(400).json({
			success: false,
			mensaje: 'Sesión sin matrícula/CodOperador — no se puede registrar la acción clínica',
		});
		return null;
	}
	return p;
}

const CLAVES_AUTOR_BODY = new Set([
	'operador',
	'operadorcarga',
	'operadoregreso',
	'codoperador',
	'idoperador',
	'idcodoperador',
	'profecional',
	'profesional',
	'profesionalasiste',
	'idprofecional',
	'idprofesional',
	'matriculasolicitante',
	'matricularealizador',
]);

/** Saca del payload cualquier autor que mande el cliente. No toca `profesionales` (equipo). */
function quitarAutorDelBody(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
	for (const k of Object.keys(data)) {
		if (CLAVES_AUTOR_BODY.has(k.toLowerCase())) delete data[k];
	}
	return data;
}

/**
 * Identidad para grabar: siempre el usuario de la sesión.
 * @returns {{ codOperador: number, profesional: number, matricula: number|null } | null}
 */
function firmarSesion(req, res) {
	const codOperador = requireOperadorCarga(req, res);
	if (codOperador == null) return null;
	const profesional = resolveProfesional(req) ?? codOperador;
	return {
		codOperador,
		profesional,
		matricula: resolveMatricula(req),
	};
}

module.exports = {
	resolveCodOperador,
	resolveMatricula,
	resolveOperadorCarga,
	resolveProfesional,
	requireOperadorCarga,
	requireProfesional,
	quitarAutorDelBody,
	firmarSesion,
	CLAVES_AUTOR_BODY,
};
