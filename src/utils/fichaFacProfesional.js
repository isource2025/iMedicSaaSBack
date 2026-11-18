/**
 * imFacProfesionales.Matricula guarda FICHA (imPersonal.Valor), no la matrícula profesional.
 * Agenda / toma de estudios identifican al médico por matrícula; el puente es
 * imPersonal.Matricula → Valor. Sin matrícula cargada en personal no se puede facturar.
 *
 * @see identidad/contrato.js → 'imFacProfesionales.Matricula': FICHA
 */
const { executeQuery } = require('../models/db');

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

/**
 * Resuelve la ficha a grabar en imFacProfesionales.Matricula.
 * Prioriza ficha conocida; si no, busca por matrícula en imPersonal.
 * No hace fallback a la matrícula: Clarion espera Valor.
 *
 * @param {{ ficha?: number|null, matricula?: number|null }} args
 * @returns {Promise<number>}
 */
async function resolverFichaParaFacProfesional({ ficha, matricula } = {}) {
	const f = Number(ficha);
	if (Number.isFinite(f) && f > 0) return f;

	const m = Number(matricula);
	if (!Number.isFinite(m) || m <= 0) {
		throw _httpError(
			'No se pudo identificar al profesional para facturación (falta ficha o matrícula).',
		);
	}

	const rows = await executeQuery(
		`SELECT TOP 1 Valor FROM dbo.imPersonal WHERE Matricula = @p0
		 ORDER BY CASE WHEN Valor = Matricula THEN 0 ELSE 1 END, Valor`,
		[{ value: m, type: 'Int' }],
	);
	const v = Number(rows?.[0]?.Valor);
	if (!Number.isFinite(v) || v <= 0) {
		throw _httpError(
			`El profesional (matrícula ${m}) no tiene matrícula cargada en personal: no se puede vincular la práctica a facturación.`,
		);
	}
	return v;
}

/**
 * JOIN / APPLY seguro: fprof.Matricula es ficha; prioriza Valor, admite matrícula legacy.
 */
function sqlJoinPersonalDesdeFacProf(aliasPersonal = 'prof', aliasFac = 'fprof') {
	return `
			 OUTER APPLY (
			   SELECT TOP 1 p.ApellidoNombre, p.Valor, p.Matricula, p.ValorEspecialidad, p.ValorServicio
			   FROM dbo.imPersonal p
			   WHERE p.Valor = ${aliasFac}.Matricula OR p.Matricula = ${aliasFac}.Matricula
			   ORDER BY CASE WHEN p.Valor = ${aliasFac}.Matricula THEN 0 ELSE 1 END, p.Valor
			 ) ${aliasPersonal}`;
}

module.exports = {
	resolverFichaParaFacProfesional,
	sqlJoinPersonalDesdeFacProf,
};
