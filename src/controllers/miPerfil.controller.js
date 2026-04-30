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

const actualizarPerfil = async (req, res) => {
	try {
		await miPerfilService.actualizarPerfilPersonal(req.valorPersonal, req.body || {});
		const data = await miPerfilService.obtenerPerfilCompleto(req.valorPersonal);
		res.json({ success: true, mensaje: 'Perfil actualizado', data });
	} catch (error) {
		console.error('[miPerfil.actualizarPerfil]', error);
		const status = error.statusCode || 500;
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar perfil',
		});
	}
};

const obtenerFotoPerfil = async (req, res) => {
	try {
		const data = await miPerfilService.obtenerFotoPerfil(req.valorPersonal);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[miPerfil.obtenerFotoPerfil]', error);
		res.status(500).json({ success: false, mensaje: error.message || 'Error al obtener la foto' });
	}
};

const actualizarFotoPerfil = async (req, res) => {
	try {
		if (!req.file?.buffer) {
			return res.status(400).json({ success: false, mensaje: 'Adjunte una imagen (campo archivo)' });
		}
		await miPerfilService.actualizarFotoPerfil(req.valorPersonal, req.file.buffer);
		res.json({ success: true, mensaje: 'Foto actualizada' });
	} catch (error) {
		console.error('[miPerfil.actualizarFotoPerfil]', error);
		const status = error.statusCode || 500;
		res.status(status).json({ success: false, mensaje: error.message || 'Error al actualizar la foto' });
	}
};

const eliminarFotoPerfil = async (req, res) => {
	try {
		await miPerfilService.eliminarFotoPerfil(req.valorPersonal);
		res.json({ success: true, mensaje: 'Foto eliminada' });
	} catch (error) {
		console.error('[miPerfil.eliminarFotoPerfil]', error);
		res.status(500).json({ success: false, mensaje: error.message || 'Error al eliminar la foto' });
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
	actualizarPerfil,
	obtenerFotoPerfil,
	actualizarFotoPerfil,
	eliminarFotoPerfil,
	obtenerProduccionMes,
	listarConveniosProduccion,
};
