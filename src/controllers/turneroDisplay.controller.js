const turneroService = require('../services/turnero.service');
const turneroEvents = require('../services/turneroEvents.service');
const tokenIndex = require('../services/turneroTokenIndex.service');

function _err(res, e) {
	const status = e.statusCode || 500;
	res.status(status).json({
		success: false,
		mensaje: e.message || 'Error interno',
		code: e.code,
	});
}

async function obtenerEstado(req, res) {
	try {
		const token = String(req.params.token || '').trim();
		const data = await turneroService.obtenerDisplayPorToken(token);
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function streamEventos(req, res) {
	const token = String(req.params.token || '').trim();
	if (!token) {
		return res.status(400).json({ success: false, mensaje: 'Token inválido' });
	}

	try {
		const idEmpresa = await tokenIndex.resolveEmpresaByToken(token);
		if (!idEmpresa) {
			return res.status(404).json({ success: false, mensaje: 'Pantalla no encontrada' });
		}
	} catch (e) {
		return _err(res, e);
	}

	req.socket.setTimeout(0);
	req.setTimeout(0);

	res.status(200);
	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no');
	if (req.headers.origin) {
		res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
		res.setHeader('Vary', 'Origin');
	}
	res.flushHeaders?.();

	res.write(': connected\n\n');

	const heartbeat = setInterval(() => {
		try {
			res.write(': ping\n\n');
		} catch {
			clearInterval(heartbeat);
		}
	}, 25000);

	const unsubscribe = turneroEvents.subscribe(token, res);

	req.on('close', () => {
		clearInterval(heartbeat);
		unsubscribe();
		try {
			res.end();
		} catch {
			/* ya cerrado */
		}
	});
}

module.exports = {
	obtenerEstado,
	streamEventos,
};
