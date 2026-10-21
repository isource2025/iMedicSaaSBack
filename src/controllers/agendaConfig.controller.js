const service = require('../services/agendaConfig.service');
const personalService = require('../services/personal.service');
const {
	DIAS_SEMANA,
	MOTIVOS_NO_HORARIO,
	STATUS_TURNO,
	TIPO_TURNO,
	INTERVALOS_SUGERIDOS,
} = require('../utils/agendaCatalogos');

/**
 * Personal → AGENDA / Turnos → Configuración de horarios.
 * Las rutas ya exigen TURNOS.CONFIGURACION.* / EXCEPCIONES.* (requirePermiso).
 * Siempre se opera sobre la matrícula del path (el profesional editado),
 * nunca sobre la del usuario logueado — aunque el JWT diga MEDICO.
 */
function matriculaDelPath(req, res) {
	const m = Number(req.params.matricula);
	if (!Number.isFinite(m) || m <= 0) {
		res.status(400).json({ success: false, mensaje: 'Matrícula inválida' });
		return null;
	}
	return m;
}

function _err(res, e) {
	const code = e?.statusCode || 500;
	console.error('[agendaConfig.controller] error:', e?.message);
	return res.status(code).json({ success: false, mensaje: e?.message || 'Error interno' });
}

// ───── Catálogos ─────
async function obtenerCatalogos(req, res) {
	try {
		let especialidades = [];
		try {
			especialidades = await personalService.listarEspecialidades();
		} catch (e) {
			console.warn('[agendaConfig] especialidades no disponibles:', e?.message);
		}
		res.json({
			success: true,
			data: {
				dias: DIAS_SEMANA,
				motivosNoHorario: MOTIVOS_NO_HORARIO,
				statusTurno: STATUS_TURNO,
				tipoTurno: TIPO_TURNO,
				intervalosSugeridos: INTERVALOS_SUGERIDOS,
				especialidades,
			},
		});
	} catch (e) {
		_err(res, e);
	}
}

// ───── Horarios ─────
async function obtenerHorarios(req, res) {
	try {
		const m = matriculaDelPath(req, res);
		if (m == null) return;
		const data = await service.obtenerHorariosPorMatricula(m);
		res.json({ success: true, data });
	} catch (e) { _err(res, e); }
}

async function reemplazarHorarios(req, res) {
	try {
		const m = matriculaDelPath(req, res);
		if (m == null) return;
		const data = await service.reemplazarHorarios(m, req.body);
		res.json({ success: true, data });
	} catch (e) { _err(res, e); }
}

// ───── No-horarios ─────
async function listarNoHorarios(req, res) {
	try {
		const m = matriculaDelPath(req, res);
		if (m == null) return;
		const data = await service.listarNoHorarios(m, {
			desde: req.query.desde,
			hasta: req.query.hasta,
		});
		res.json({ success: true, data });
	} catch (e) { _err(res, e); }
}

async function crearNoHorario(req, res) {
	try {
		const m = matriculaDelPath(req, res);
		if (m == null) return;
		const codOp = req.auth?.usuario?.codOperador;
		const data = await service.crearNoHorario(m, codOp, req.body);
		res.status(201).json({ success: true, data });
	} catch (e) { _err(res, e); }
}

async function actualizarNoHorario(req, res) {
	try {
		const m = matriculaDelPath(req, res);
		if (m == null) return;
		const codOp = req.auth?.usuario?.codOperador;
		const data = await service.actualizarNoHorario(m, codOp, req.body);
		res.json({ success: true, data });
	} catch (e) { _err(res, e); }
}

async function eliminarNoHorario(req, res) {
	try {
		const m = matriculaDelPath(req, res);
		if (m == null) return;
		const data = await service.eliminarNoHorario(m, req.body);
		res.json({ success: true, data });
	} catch (e) { _err(res, e); }
}

module.exports = {
	obtenerCatalogos,
	obtenerHorarios,
	reemplazarHorarios,
	listarNoHorarios,
	crearNoHorario,
	actualizarNoHorario,
	eliminarNoHorario,
};
