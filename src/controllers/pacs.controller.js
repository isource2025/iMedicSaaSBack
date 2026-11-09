const pacsService = require('../services/pacs.service');

async function health(_req, res) {
	try {
		const data = await pacsService.health();
		res.json(data);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

async function listarPorPaciente(req, res) {
	try {
		const patientId = req.params.patientId || req.query.patientId;
		if (!patientId) return res.status(400).json({ error: 'Falta patientId (DNI)' });
		const data = await pacsService.listarEstudiosPorPatientId(patientId);
		res.json(data);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

async function listarPorVisita(req, res) {
	try {
		const data = await pacsService.listarEstudiosPorVisita(req.params.numeroVisita);
		res.json(data);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

async function obtenerEstudio(req, res) {
	try {
		const data = await pacsService.obtenerEstudio(req.params.studyUid);
		res.json(data);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

async function listarSeries(req, res) {
	try {
		const data = await pacsService.listarSeries(req.params.studyUid);
		res.json(data);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

async function listarArchivos(req, res) {
	try {
		const data = await pacsService.listarArchivos(req.params.studyUid);
		res.json(data);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

async function descargarArchivo(req, res) {
	try {
		const rel = req.query.path;
		if (!rel) return res.status(400).json({ error: 'Falta query path' });
		const upstream = await pacsService.streamArchivo(req.params.studyUid, rel);
		if (upstream.status >= 400) {
			return res.status(upstream.status).json({ error: 'No se pudo obtener el DICOM' });
		}
		res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/dicom');
		if (upstream.headers['content-disposition']) {
			res.setHeader('Content-Disposition', upstream.headers['content-disposition']);
		}
		upstream.data.pipe(res);
	} catch (e) {
		res.status(e.status || 502).json({ error: e.message, code: e.code || 'PACS_ERROR' });
	}
}

module.exports = {
	health,
	listarPorPaciente,
	listarPorVisita,
	obtenerEstudio,
	listarSeries,
	listarArchivos,
	descargarArchivo,
};
