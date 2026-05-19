/**
 * Buscar tablas de parámetros / catálogos en la BD que podrían contener
 * el "código de consulta para facturación" mencionado por el usuario.
 */
const db = require('../src/models/db');

(async () => {
	try {
		console.log('\n=== Tablas que matchean %arametro%, %param%, x%, %Codigo% ===');
		const tablas = await db.executeQuery(
			`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_NAME LIKE '%arametro%' OR TABLE_NAME LIKE 'x%' OR TABLE_NAME LIKE '%onfig%'
			 ORDER BY TABLE_NAME`,
		);
		console.log(JSON.stringify(tablas, null, 2));

		console.log('\n=== Tablas que tengan columna "Parametro" o "Valor" + descripcion ===');
		const cols = await db.executeQuery(
			`SELECT TABLE_NAME, COLUMN_NAME
			 FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE COLUMN_NAME IN ('Parametro','Parametros','NombreParametro','CodigoParametro')
			 ORDER BY TABLE_NAME`,
		);
		console.log(JSON.stringify(cols, null, 2));

		// imInterCtrlFrecuente (singular) columnas
		console.log('\n=== imInterCtrlFrecuente columnas ===');
		const c = await db.executeQuery(
			`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
			 FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imInterCtrlFrecuente'
			 ORDER BY ORDINAL_POSITION`,
		);
		console.log(JSON.stringify(c, null, 2));

		console.log('\n=== imInterCtrlFrecuente: TOP 2 ===');
		try {
			const s = await db.executeQuery(`SELECT TOP 2 * FROM dbo.imInterCtrlFrecuente`);
			console.log(JSON.stringify(s, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		console.log('\n=== imHCI max IdHCIngreso y muestra TOP 2 ===');
		try {
			const m = await db.executeQuery(`SELECT MAX(IdHCIngreso) AS maxId FROM dbo.imHCI`);
			console.log(JSON.stringify(m, null, 2));
			const s = await db.executeQuery(
				`SELECT TOP 2 IdHCIngreso, NumeroVisita, Fecha, IdSector, IdProfecional, MotivoConsulta
				 FROM dbo.imHCI ORDER BY IdHCIngreso DESC`,
			);
			console.log(JSON.stringify(s, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		console.log('\n=== imFacPracticas TOP 3 reciente con Practica/TipoPractica ===');
		try {
			const s = await db.executeQuery(
				`SELECT TOP 3 Valor, NumeroVisita, TipoPractica, Practica, CantidadPractica,
				        FechaPractica, HoraPracticaInicio, ValorSector, IdPaciente, DescPractica
				 FROM dbo.imFacPracticas ORDER BY Valor DESC`,
			);
			console.log(JSON.stringify(s, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		console.log('\n=== imFacProfesionales: muestra reciente con Funcion DISTINCT ===');
		try {
			const s = await db.executeQuery(
				`SELECT TOP 5 Funcion, COUNT(*) AS cant FROM dbo.imFacProfesionales GROUP BY Funcion ORDER BY cant DESC`,
			);
			console.log(JSON.stringify(s, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		console.log('\n=== Buscar parámetros / catálogos con "consulta" o "consult" ===');
		try {
			const tnames = await db.executeQuery(
				`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME`,
			);
			console.log(`Total tablas en la BD: ${tnames.length}`);
			const matches = tnames.filter((t) =>
				/parametr|consult|codig|factur|prefer|setting|sistema/i.test(t.TABLE_NAME),
			);
			console.log('Posibles tablas catálogo/parametros:');
			console.log(JSON.stringify(matches, null, 2));
		} catch (e) {
			console.log('err:', e.message);
		}

		process.exit(0);
	} catch (e) {
		console.error('Error general:', e.message);
		process.exit(1);
	}
})();
