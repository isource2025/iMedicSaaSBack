/**
 * Matrícula efectiva del profesional en la BD tenant (dbo.imPersonal).
 * El JWT / MySQL central puede traer una Matricula desactualizada o distinta
 * de la usada en imPersonalHorarios / imAgenda → grilla vacía / todo sobreturno.
 */
const { executeQuery } = require('../models/db');

async function resolverMatriculaTenant(valorPersonal) {
	const vp = Number(valorPersonal);
	if (!Number.isFinite(vp) || vp <= 0) return null;
	const rows = await executeQuery(
		'SELECT TOP 1 Matricula FROM dbo.imPersonal WHERE Valor = @p0',
		[{ value: vp, type: 'Int' }],
	);
	const m = rows?.[0]?.Matricula;
	const n = m != null && m !== '' ? Number(m) : NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Para rol MEDICO: fuerza matrícula desde imPersonal tenant (ignora path/JWT stale).
 * Para el resto: valida el path param.
 * @returns {Promise<number|null>} null si ya se respondió el error HTTP
 */
async function matriculaAlcanceAgenda(req, res, matriculaParam) {
	const esMedico = String(req.rolNombre || '').toUpperCase() === 'MEDICO';

	if (esMedico) {
		let mat =
			req.matricula != null && Number(req.matricula) > 0 ? Number(req.matricula) : null;
		if (req.valorPersonal != null) {
			try {
				const tenantMat = await resolverMatriculaTenant(req.valorPersonal);
				if (tenantMat) {
					mat = tenantMat;
					req.matricula = tenantMat;
					if (req.auth?.usuario) req.auth.usuario.matricula = tenantMat;
				}
			} catch (e) {
				console.warn('[matriculaTenant] no se pudo resolver Matricula:', e?.message);
			}
		}
		if (mat == null) {
			res.status(403).json({
				success: false,
				mensaje: 'Tu usuario no tiene matrícula asignada en personal del establecimiento',
			});
			return null;
		}
		return mat;
	}

	const m = Number(matriculaParam);
	if (!Number.isFinite(m) || m <= 0) {
		res.status(400).json({ success: false, mensaje: 'Matrícula inválida' });
		return null;
	}
	return m;
}

module.exports = {
	resolverMatriculaTenant,
	matriculaAlcanceAgenda,
};
