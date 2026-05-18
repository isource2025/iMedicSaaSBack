/**
 * Auditoría de tablas de Agenda:
 *   imPersonalHorarios, imPersonalNoHorarios, imTurnos, imFeriados
 *
 * - Lista columnas (tipo y longitud)
 * - Cuenta filas
 * - Trae 3 filas de ejemplo
 * - Muestra índices
 */
const db = require('../src/models/db');

const TABLAS = [
	'imPersonalHorarios',
	'imPersonalNoHorarios',
	'imTurnos',
	'imFeriados',
];

(async () => {
	try {
		for (const t of TABLAS) {
			console.log('\n============================================================');
			console.log(`TABLA: ${t}`);
			console.log('============================================================');

			const cols = await db.executeQuery(
				`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
				 FROM INFORMATION_SCHEMA.COLUMNS
				 WHERE TABLE_NAME = '${t}'
				 ORDER BY ORDINAL_POSITION`
			);

			if (!cols.length) {
				console.log(`  [!] La tabla ${t} NO existe (o el usuario no tiene permiso).`);
				continue;
			}

			console.log('Columnas:');
			cols.forEach((c) => {
				const len = c.CHARACTER_MAXIMUM_LENGTH ? `(${c.CHARACTER_MAXIMUM_LENGTH})` : '';
				const nul = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
				const def = c.COLUMN_DEFAULT ? ` DEFAULT ${c.COLUMN_DEFAULT}` : '';
				console.log(`  - ${c.COLUMN_NAME.padEnd(28)} ${c.DATA_TYPE}${len}  ${nul}${def}`);
			});

			try {
				const cnt = await db.executeQuery(`SELECT COUNT(*) AS total FROM dbo.${t}`);
				console.log(`Filas: ${cnt[0].total}`);
			} catch (e) {
				console.log(`Filas: error -> ${e.message}`);
			}

			try {
				const sample = await db.executeQuery(`SELECT TOP 3 * FROM dbo.${t}`);
				console.log('Muestra (TOP 3):');
				console.log(JSON.stringify(sample, null, 2));
			} catch (e) {
				console.log(`Muestra: error -> ${e.message}`);
			}

			try {
				const idx = await db.executeQuery(
					`SELECT i.name AS index_name, i.is_unique, i.is_primary_key,
					        STUFF((SELECT ', ' + c.name
					               FROM sys.index_columns ic
					               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
					               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
					               ORDER BY ic.key_ordinal
					               FOR XML PATH('')), 1, 2, '') AS columnas
					 FROM sys.indexes i
					 WHERE i.object_id = OBJECT_ID('dbo.${t}') AND i.type > 0`
				);
				console.log('Índices:');
				idx.forEach((r) => {
					const tag = r.is_primary_key ? 'PK' : r.is_unique ? 'UQ' : 'IX';
					console.log(`  ${tag}  ${r.index_name}  (${r.columnas})`);
				});
			} catch (e) {
				console.log(`Índices: error -> ${e.message}`);
			}
		}

		process.exit(0);
	} catch (e) {
		console.error('Error general:', e.message);
		process.exit(1);
	}
})();
