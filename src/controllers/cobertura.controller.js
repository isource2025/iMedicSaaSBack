const coberturaService = require('../services/cobertura.service');
const afiliacionService = require('../services/afiliacion.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

async function getCobertura(req, res) {
	try {
		const data = await coberturaService.getCobertura();
		res.json(data);
	} catch (error) {
		console.error('Error al obtener cobertura:', error);
		res.status(statusDeError(error)).json({ error: 'Error al obtener cobertura' });
	}
}

async function validarAfiliado(req, res) {
	try {
		const documento = req.params.documento;
		if (!documento) {
			return res.status(400).json({ error: 'Documento requerido' });
		}
		const data = await afiliacionService.validarAfiliadoPorDocumento(documento);
		res.json(data);
	} catch (error) {
		console.error('Error al validar afiliado:', error);
		res.status(statusDeError(error)).json({ error: 'Error al validar afiliado' });
	}
}

async function validarAfiliadoEnCobertura(req, res) {
	try {
		const { valor, nroAfiliado } = req.params;
		const data = await afiliacionService.validarAfiliadoEnCobertura(valor, nroAfiliado);
		res.json(data);
	} catch (error) {
		console.error('Error al validar afiliado en cobertura:', error);
		res.status(statusDeError(error)).json({
			error: mensajeDeError(error, 'Error al validar afiliado'),
		});
	}
}

module.exports = { getCobertura, validarAfiliado, validarAfiliadoEnCobertura };
