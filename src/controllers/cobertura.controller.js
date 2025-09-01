// Controller para cobertura
const coberturaService = require('../services/cobertura.service');

async function getCobertura(req, res) {
	try {
		const data = await coberturaService.getCobertura();

		res.json(data);
	} catch (error) {
		console.error('Error al obtener cobertura:', error);
		res.status(500).json({ error: 'Error al obtener cobertura' });
	}
}

module.exports = { getCobertura };
