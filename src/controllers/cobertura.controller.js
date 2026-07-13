const coberturaService = require('../services/cobertura.service');
const afiliacionService = require('../services/afiliacion.service');

async function getCobertura(req, res) {
	try {
		const data = await coberturaService.getCobertura();
		res.json(data);
	} catch (error) {
		console.error('Error al obtener cobertura:', error);
		res.status(500).json({ error: 'Error al obtener cobertura' });
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
		res.status(500).json({ error: 'Error al validar afiliado' });
	}
}

module.exports = { getCobertura, validarAfiliado };
