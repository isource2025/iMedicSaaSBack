/**
 * Pobla depósitos base de almacén si no existen (datos de BD, no hardcode de UI).
 * Uso: node scripts/seed_depositos_base.js
 */
require('dotenv').config();
const { executeQuery } = require('../src/models/db');
const { ensureAlmacenSchema } = require('../src/services/almacen.schema');

async function main() {
	await ensureAlmacenSchema();
	const rows = await executeQuery(`
    SELECT IdDeposito, Codigo, Nombre, EsPrincipal, Activo
    FROM dbo.imAlmacenDeposito
    ORDER BY EsPrincipal DESC, Nombre
  `);
	console.log('Depósitos activos/existentes:', rows);
	if (!rows?.length) {
		console.log('No hay depósitos. Revisá el schema seed (imAlmacenDeposito).');
	} else {
		console.log(`OK · ${rows.length} depósito(s). El principal se usa por defecto en Stock/Órdenes.`);
	}
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
