/**
 * Auditoría para implementar "Cerrar turno":
 *  - imVisita, imHCI, imFacPracticas, imFacProfesionales
 *  - imInterCtrlFrecuentes, imInterCtrlMedicamento (update con IdTurno y NumeroVisita)
 *  - imTurnos (verificar columna NumeroVisita)
 *  - xParametro (buscar código de consulta para facturación)
 */
const db = require('../src/models/db');

const TABLAS = [
	'imVisita',
	'imHCI',
	'imFacPracticas',
	'imFacProfesionales',
	'imInterCtrlFrecuentes',
	'imInterCtrlMedicamento',
	'imTurnos',
	'xParametro',
];

async function q(label, sql) {
	console.log(`\n--- ${label} ---`);
	try {
		const rows = await db.executeQuery(sql);
		console.log(`(${rows.length} filas)`);
		console.log(JSON.stringify(rows, null, 2));
	} catch (e) {
		console.log(`ERROR: ${e.message}`);
	}
}

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
				 ORDER BY ORDINAL_POSITION`,
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
				console.log(`  - ${String(c.COLUMN_NAME).padEnd(30)} ${c.DATA_TYPE}${len}  ${nul}${def}`);
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
					 WHERE i.object_id = OBJECT_ID('dbo.${t}') AND i.type > 0`,
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

		// ────────────── xParametro: buscar código de consulta para facturación ──────────────
		await q(
			'xParametro: parámetros que contienen "consulta"/"codigo"/"factur"',
			`SELECT TOP 50 *
			 FROM dbo.xParametro
			 WHERE (Descripcion LIKE '%consulta%' OR Descripcion LIKE '%codigo%' OR Descripcion LIKE '%factur%'
			        OR Parametro LIKE '%CONSULT%' OR Parametro LIKE '%CODIGO%' OR Parametro LIKE '%FACT%')
			 ORDER BY Parametro`,
		);

		await q(
			'xParametro: muestra TOP 20',
			`SELECT TOP 20 * FROM dbo.xParametro ORDER BY Parametro`,
		);

		// ────────────── imVisita: máximos / DISTINCT de ClasePaciente ──────────────
		await q(
			'imVisita: máximo NumeroVisita',
			`SELECT MAX(NumeroVisita) AS maxNumeroVisita FROM dbo.imVisita`,
		);
		await q(
			'imVisita: DISTINCT ClasePaciente (top 20)',
			`SELECT TOP 20 ClasePaciente, COUNT(*) AS cant
			 FROM dbo.imVisita GROUP BY ClasePaciente ORDER BY cant DESC`,
		);

		// ────────────── imTurnos: ¿tiene NumeroVisita? ──────────────
		await q(
			'imTurnos: columnas que contengan "visita"',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imTurnos' AND COLUMN_NAME LIKE '%isita%'`,
		);

		// ────────────── imInterCtrl* : ¿tienen IdTurno y NumeroVisita? ──────────────
		await q(
			'imInterCtrlFrecuentes: columnas IdTurno / NumeroVisita',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imInterCtrlFrecuentes'
			   AND (COLUMN_NAME LIKE '%urno%' OR COLUMN_NAME LIKE '%isita%')`,
		);
		await q(
			'imInterCtrlMedicamento: columnas IdTurno / NumeroVisita',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imInterCtrlMedicamento'
			   AND (COLUMN_NAME LIKE '%urno%' OR COLUMN_NAME LIKE '%isita%')`,
		);

		// ────────────── imFacPracticas: muestra reciente ──────────────
		await q(
			'imFacPracticas: TOP 5 más reciente',
			`SELECT TOP 5 * FROM dbo.imFacPracticas ORDER BY 1 DESC`,
		);

		await q(
			'imFacProfesionales: TOP 5 más reciente',
			`SELECT TOP 5 * FROM dbo.imFacProfesionales ORDER BY 1 DESC`,
		);

		await q(
			'imHCI: TOP 3',
			`SELECT TOP 3 * FROM dbo.imHCI`,
		);

		await q(
			'imVisita: TOP 5 (últimas)',
			`SELECT TOP 5 * FROM dbo.imVisita ORDER BY NumeroVisita DESC`,
		);

		process.exit(0);
	} catch (e) {
		console.error('Error general:', e.message);
		process.exit(1);
	}
})();
