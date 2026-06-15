/**
 * Identidad clínica desde JWT (no confiar en campos del body).
 */
function resolveCodOperador(req) {
	const u = req.auth?.usuario || {};
	const candidates = [req.codOperador, u.codOperador, u.idCodOperador, u.CodOperador];
	for (const c of candidates) {
		if (c == null || c === '') continue;
		const n = Number(c);
		if (Number.isFinite(n)) return n;
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

/** Matrícula profesional; si no hay, usa CodOperador (enfermería). */
function resolveProfesional(req) {
	return resolveMatricula(req) ?? resolveCodOperador(req);
}

function requireOperadorCarga(req, res) {
	const op = resolveOperadorCarga(req);
	if (op == null || !Number.isFinite(op)) {
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
	if (p == null || !Number.isFinite(p)) {
		res.status(400).json({
			success: false,
			mensaje: 'Sesión sin matrícula/CodOperador — no se puede registrar la acción clínica',
		});
		return null;
	}
	return p;
}

module.exports = {
	resolveCodOperador,
	resolveMatricula,
	resolveOperadorCarga,
	resolveProfesional,
	requireOperadorCarga,
	requireProfesional,
};
