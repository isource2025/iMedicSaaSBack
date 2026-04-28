const miPerfilService = require('../services/miPerfil.service');

const obtenerPerfil = async (req, res) => {
	try {
		const data = await miPerfilService.obtenerPerfilCompleto(req.valorPersonal);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[miPerfil.obtenerPerfil]', error);
		res.status(500).json({ success: false, mensaje: error.message || 'Error al cargar el perfil' });
	}
};

const obtenerProduccionMes = async (req, res) => {
	try {
		const data = await miPerfilService.obtenerProduccionConFiltros(req.valorPersonal, {
			desde: req.query.desde,
			hasta: req.query.hasta,
			idConvenio: req.query.idConvenio,
		});
		res.json({ success: true, data });
	} catch (error) {
		console.error('[miPerfil.obtenerProduccionMes]', error);
		const status = error.statusCode || 500;
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al cargar la producción',
		});
	}
};

const listarConveniosProduccion = async (req, res) => {
	try {
		const data = await miPerfilService.listarConveniosProduccion(
			req.valorPersonal,
			req.query.desde,
			req.query.hasta,
		);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[miPerfil.listarConveniosProduccion]', error);
		const status = error.statusCode || 500;
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al listar obras sociales',
		});
	}
};

module.exports = {
	obtenerPerfil,
	obtenerProduccionMes,
	listarConveniosProduccion,
};
