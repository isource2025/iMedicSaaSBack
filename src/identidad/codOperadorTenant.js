/**
 * CodOperador de la cuenta según la base del hospital (dbo.imPassword), que es la fuente:
 * Clarion lo asigna y la nube solo lo espeja. Se busca por ficha + usuario porque una
 * ficha puede tener varias cuentas.
 */
const { executeQuery } = require('../models/db');

async function resolverCodOperadorTenant(valorPersonal, nombreRed) {
	const vp = Number(valorPersonal);
	const usuario = String(nombreRed || '').trim();
	if (!Number.isFinite(vp) || vp <= 0 || !usuario) return null;
	const rows = await executeQuery(
		`SELECT TOP 2 CodOperador FROM dbo.imPassword
		 WHERE ValorPersonal = @p0 AND UPPER(LTRIM(RTRIM(NombreRed))) = UPPER(@p1)`,
		[
			{ value: vp, type: 'Int' },
			{ value: usuario, type: 'VarChar' },
		],
	);
	if (rows.length !== 1) return null;
	const n = Number(String(rows[0].CodOperador ?? '').trim());
	return Number.isFinite(n) && n > 0 ? n : null;
}

module.exports = { resolverCodOperadorTenant };
