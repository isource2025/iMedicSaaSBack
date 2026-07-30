const epicrisisService = require('../services/epicrisis.service');
const epicrisisIaService = require('../services/epicrisisIa.service');

const listarPorVisita = async (req, res) => {
	try {
		const idVisita = Number(req.params.idVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		const rows = await epicrisisService.listarPorVisita(idVisita);
		return res.json({ success: true, data: rows || [] });
	} catch (err) {
		console.error('[Epicrisis] listar:', err);
		return res.status(500).json({
			success: false,
			mensaje: 'Error al listar epicrisis',
			error: err.message,
		});
	}
};

const obtenerPorId = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const row = await epicrisisService.obtenerPorId(id);
		if (!row) {
			return res.status(404).json({ success: false, mensaje: 'Epicrisis no encontrada' });
		}
		return res.json({ success: true, data: row });
	} catch (err) {
		console.error('[Epicrisis] obtener:', err);
		return res.status(500).json({
			success: false,
			mensaje: 'Error al obtener epicrisis',
			error: err.message,
		});
	}
};

const crear = async (req, res) => {
	try {
		const data = req.body || {};
		if (!data.IdVisita) {
			return res.status(400).json({ success: false, mensaje: 'IdVisita es requerido' });
		}
		if (!data.Fecha) {
			return res.status(400).json({ success: false, mensaje: 'Fecha es requerida' });
		}
		if (!data.Hora) {
			return res.status(400).json({ success: false, mensaje: 'Hora es requerida' });
		}
		if (!data.IdSector) {
			return res.status(400).json({ success: false, mensaje: 'IdSector es requerido' });
		}
		if (!data.Epicrisis || !String(data.Epicrisis).trim()) {
			return res.status(400).json({ success: false, mensaje: 'Epicrisis es requerida' });
		}
		if (!data.NumeroDocumento) {
			return res.status(400).json({ success: false, mensaje: 'NumeroDocumento es requerido' });
		}

		const resultado = await epicrisisService.crear(data);
		return res.status(201).json({
			success: true,
			data: resultado,
			mensaje: 'Epicrisis creada correctamente',
		});
	} catch (err) {
		console.error('[Epicrisis] crear:', err);
		return res.status(500).json({
			success: false,
			mensaje: 'Error al crear epicrisis',
			error: err.message,
		});
	}
};

const actualizar = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const data = req.body || {};
		if (!data.Epicrisis || !String(data.Epicrisis).trim()) {
			return res.status(400).json({ success: false, mensaje: 'Epicrisis es requerida' });
		}
		await epicrisisService.actualizar(id, data);
		return res.json({ success: true, mensaje: 'Epicrisis actualizada correctamente' });
	} catch (err) {
		console.error('[Epicrisis] actualizar:', err);
		return res.status(500).json({
			success: false,
			mensaje: 'Error al actualizar epicrisis',
			error: err.message,
		});
	}
};

const eliminar = async (req, res) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		await epicrisisService.eliminar(id);
		return res.json({ success: true, mensaje: 'Epicrisis eliminada correctamente' });
	} catch (err) {
		console.error('[Epicrisis] eliminar:', err);
		return res.status(500).json({
			success: false,
			mensaje: 'Error al eliminar epicrisis',
			error: err.message,
		});
	}
};

const generarConIA = async (req, res) => {
	try {
		const idVisita = Number(req.params.idVisita || req.body?.IdVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		const draft = await epicrisisIaService.generarBorrador(idVisita);
		return res.json({
			success: true,
			data: draft,
			mensaje:
				draft.fuente === 'openai'
					? 'Borrador generado con IA — revise antes de guardar'
					: draft.aviso || 'Borrador plantilla generado',
		});
	} catch (err) {
		console.error('[Epicrisis] IA:', err);
		const status = err.statusCode || 500;
		return res.status(status).json({
			success: false,
			mensaje: err.message || 'Error al generar epicrisis con IA',
		});
	}
};

module.exports = {
	listarPorVisita,
	obtenerPorId,
	crear,
	actualizar,
	eliminar,
	generarConIA,
};
