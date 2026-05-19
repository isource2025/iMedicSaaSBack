const db = require('../src/models/db');

(async () => {
	try {
		console.log('\n=== XPARAMETROS columnas ===');
		const c = await db.executeQuery(
			`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
			 FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='XPARAMETROS' ORDER BY ORDINAL_POSITION`,
		);
		console.log(JSON.stringify(c, null, 2));

		console.log('\n=== XPARAMETROS COUNT ===');
		const cnt = await db.executeQuery(`SELECT COUNT(*) AS total FROM dbo.XPARAMETROS`);
		console.log(JSON.stringify(cnt, null, 2));

		console.log('\n=== XPARAMETROS TOP 10 ===');
		const s = await db.executeQuery(`SELECT TOP 10 * FROM dbo.XPARAMETROS`);
		console.log(JSON.stringify(s, null, 2));

		console.log('\n=== XPARAMETROS filter en JS ===');
		const all = await db.executeQuery(`SELECT * FROM dbo.XPARAMETROS`);
		const re = /consult|fact|turn|codig|practic|funcion/i;
		const filtered = all.filter((row) =>
			Object.entries(row).some(([k, v]) => re.test(`${k} ${v}`)),
		);
		console.log(`Total rows en XPARAMETROS: ${all.length}; matches con regex: ${filtered.length}`);
		console.log(JSON.stringify(filtered.slice(0, 80), null, 2));

		console.log('\n=== imParametros columnas ===');
		const cP = await db.executeQuery(
			`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
			 FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imParametros' ORDER BY ORDINAL_POSITION`,
		);
		console.log(JSON.stringify(cP, null, 2));

		console.log('\n=== imParametros TOP 10 ===');
		try {
			const sP = await db.executeQuery(`SELECT TOP 10 * FROM dbo.imParametros`);
			console.log(JSON.stringify(sP, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		console.log('\n=== imTParametros TOP 10 ===');
		try {
			const sT = await db.executeQuery(`SELECT TOP 10 * FROM dbo.imTParametros`);
			console.log(JSON.stringify(sT, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		process.exit(0);
	} catch (e) {
		console.error('Error general:', e.message);
		process.exit(1);
	}
})();
