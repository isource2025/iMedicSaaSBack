const { executeQuery } = require('../models/db');

async function getCobertura() {
	const query = `
    SELECT
      Valor,
      RazonSocial,
      NroAfiliadoDocumento,
      APIValidacionPaciente
    FROM imClientes
    ORDER BY RazonSocial
  `;
	const results = await executeQuery(query);
	return results.map((item) => ({
		Valor: item.Valor,
		Descripcion: item.RazonSocial,
		NroAfiliadoDocumento: item.NroAfiliadoDocumento,
		APIValidacionPaciente: item.APIValidacionPaciente,
	}));
}

module.exports = { getCobertura };
