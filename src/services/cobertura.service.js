const { executeQuery } = require('../models/db');

async function getCobertura() {
	const query = 'SELECT Valor, RazonSocial  FROM imClientes';
	const results = await executeQuery(query);
	return results.map((item) => ({ Valor: item.Valor, Descripcion: item.RazonSocial }));
}

module.exports = { getCobertura };
