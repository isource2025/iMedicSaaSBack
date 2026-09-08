const miPerfilService = require('../services/miPerfil.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const obtenerPerfil = async (req, res) => {
	try {
		const data = await miPerfilService.obtenerPerfilCompleto(req.valorPersonal);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[miPerfil.obtenerPerfil]', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: error.message || 'Error al cargar el perfil' });
	}
};

const rechazarCambio = (_req, res) => {
	res.status(403).json({
		success: false,
		mensaje: 'Los datos de Mi Perfil no se pueden modificar',
	});
};

const obtenerFotoPerfil = async (req, res) => {
	try {
		const data = await miPerfilService.obtenerFotoPerfil(req.valorPersonal);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[miPerfil.obtenerFotoPerfil]', error);
		res.status(statusDeError(error)).json({ success: false, mensaje: error.message || 'Error al obtener la foto' });
	}
};

const obtenerProduccionMes = async (req, res) => {
	try {
		const data = await miPerfilService.obtenerProduccionConFiltros(req.valorPersonal, {
			desde: req.query.desde,
			hasta: req.query.hasta,
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
	rechazarCambio,
	obtenerFotoPerfil,
	obtenerProduccionMes,
	listarConveniosProduccion,
};
