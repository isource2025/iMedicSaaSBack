const servicio = require('../services/clientesRequisitos.service');
const { statusDeError } = require('../utils/httpError');

function fallar(res, error, mensajePorDefecto) {
	const status = error?.statusCode || statusDeError(error);
	res.status(status).json({ success: false, message: error?.message || mensajePorDefecto });
}

async function coberturas(req, res) {
	try {
		const data = await servicio.listarCoberturas();
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al listar coberturas con requisitos:', error);
		fallar(res, error, 'Error al listar las coberturas');
	}
}

async function requisitosDeCobertura(req, res) {
	try {
		const data = await servicio.listarRequisitosDeCobertura(req.params.cliente);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al listar requisitos de la cobertura:', error);
		fallar(res, error, 'Error al listar los requisitos de la cobertura');
	}
}

async function guardarRequisitosDeCobertura(req, res) {
	try {
		const data = await servicio.guardarRequisitosDeCobertura(
			req.params.cliente,
			req.body?.requisitos,
		);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al guardar requisitos de la cobertura:', error);
		fallar(res, error, 'Error al guardar los requisitos de la cobertura');
	}
}

module.exports = {
	coberturas,
	requisitosDeCobertura,
	guardarRequisitosDeCobertura,
};
