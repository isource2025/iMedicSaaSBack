/**
 * Matrícula efectiva del profesional en la BD tenant (dbo.imPersonal).
 * El JWT / MySQL central puede traer una Matricula desactualizada o distinta
 * de la usada en imPersonalHorarios / imAgenda → grilla vacía / todo sobreturno.
 */
const { executeQuery } = require('../models/db');
const permisosService = require('../services/permisos.service');

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

/** Permisos de configuración/excepciones de agenda (editar horarios de terceros). */
function puedeConfigurarAgendaTerceros(permisos) {
	const lista = Array.isArray(permisos) ? permisos : [];
	return (
		permisosService.tienePermiso(lista, 'TURNOS.CONFIGURACION.VER') ||
		permisosService.tienePermiso(lista, 'TURNOS.CONFIGURACION.EDITAR') ||
		permisosService.tienePermiso(lista, 'TURNOS.CONFIGURACION.GESTIONAR') ||
		permisosService.tienePermiso(lista, 'TURNOS.EXCEPCIONES.VER') ||
		permisosService.tienePermiso(lista, 'TURNOS.EXCEPCIONES.CREAR') ||
		permisosService.tienePermiso(lista, 'TURNOS.EXCEPCIONES.EDITAR') ||
		permisosService.tienePermiso(lista, 'TURNOS.EXCEPCIONES.ELIMINAR')
	);
}

function matriculaDesdePath(res, matriculaParam) {
	const m = Number(matriculaParam);
	if (!Number.isFinite(m) || m <= 0) {
		res.status(400).json({ success: false, mensaje: 'Matrícula inválida' });
		return null;
	}
	return m;
}

/**
 * Resuelve la matrícula sobre la que opera la API de agenda.
 *
 * - ADMIN / ADMINISTRATIVO / etc.: matrícula del path.
 * - MEDICO con permiso de configurar agendas (multi-rol o matriz): path
 *   (Personal → AGENDA de otro profesional, p. ej. QUIROFANO).
 * - MEDICO “puro” (sólo su agenda operativa): fuerza matrícula propia en tenant.
 *
 * @returns {Promise<number|null>} null si ya se respondió el error HTTP
 */
async function matriculaAlcanceAgenda(req, res, matriculaParam) {
	const esMedico = String(req.rolNombre || '').toUpperCase() === 'MEDICO';
	const configurarTerceros = puedeConfigurarAgendaTerceros(req.permisos);

	// Configurar horarios/ausencias de otro personal: siempre el path.
	if (!esMedico || configurarTerceros) {
		return matriculaDesdePath(res, matriculaParam);
	}

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

module.exports = {
	resolverMatriculaTenant,
	matriculaAlcanceAgenda,
	puedeConfigurarAgendaTerceros,
};
