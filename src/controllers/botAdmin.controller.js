const botConfigService = require('../services/botConfig.service');
const botLogService = require('../services/botLog.service');
const botAgenda = require('../services/botAgenda.service');
const { parseApiKeys } = require('../middlewares/botApiKey.middleware');

async function obtenerConfigAdmin(req, res) {
	try {
		const config = await botAgenda.obtenerConfigCompleta();
		const apiKeys = parseApiKeys();
		const idEmpresa = req.idEmpresa;
		const apiConfigurada = idEmpresa != null && !!apiKeys[String(idEmpresa)];
		const { api, ...configSegura } = config;

		res.json({
			success: true,
			data: {
				...configSegura,
				apiConfigurada,
				logsDisponibles: await botLogService.checkLogTable(),
				configDbDisponible: await botConfigService.checkConfigTable(),
			},
		});
	} catch (err) {
		res.status(500).json({ success: false, mensaje: err.message });
	}
}

async function guardarConfigAdmin(req, res) {
	try {
		await botConfigService.saveBotConfig(req.body || {});
		const config = await botAgenda.obtenerConfigCompleta();
		const apiKeys = parseApiKeys();
		const idEmpresa = req.idEmpresa;
		const apiConfigurada = idEmpresa != null && !!apiKeys[String(idEmpresa)];
		const { api, ...configSegura } = config;
		res.json({
			success: true,
			data: {
				...configSegura,
				apiConfigurada,
				logsDisponibles: await botLogService.checkLogTable(),
				configDbDisponible: await botConfigService.checkConfigTable(),
			},
			mensaje: 'Configuración guardada',
		});
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

async function listarLogs(req, res) {
	try {
		const limit = req.query.limit ? Number(req.query.limit) : 50;
		const data = await botLogService.listarLogsRecientes(limit);
		res.json({ success: true, data });
	} catch (err) {
		res.status(500).json({ success: false, mensaje: err.message });
	}
}

module.exports = { obtenerConfigAdmin, guardarConfigAdmin, listarLogs };
