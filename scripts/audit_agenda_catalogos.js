/**
 * Auditoría F0: catálogos y mapeos clave para módulo Agenda.
 *  - Confirma columna Matricula en imPersonal y su relación con Valor.
 *  - DISTINCT de Status / TipoTurno / MotivodeEsepcion con conteos.
 *  - DISTINCT de IDConsultorio / IdServicio / Sector usados.
 *  - Detecta filas "Dia vacío" (guardia continua) en imPersonalHorarios.
 */
const db = require('../src/models/db');

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
		// ────────────── imPersonal: Matricula vs Valor ──────────────
		await q(
			'imPersonal: columnas con "matric" o "valor" o "rol"',
			`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
			 FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imPersonal'
			   AND (COLUMN_NAME LIKE '%atric%' OR COLUMN_NAME='Valor' OR COLUMN_NAME='Rol' OR COLUMN_NAME LIKE 'Codigo%')
			 ORDER BY ORDINAL_POSITION`
		);

		await q(
			'imPersonal: muestra Valor / Matricula / Apellido / Nombres (TOP 10 con Matricula no nula)',
			`SELECT TOP 10 Valor, Matricula, Apellido, Nombres, Rol
			 FROM dbo.imPersonal
			 WHERE Matricula IS NOT NULL AND Matricula > 0
			 ORDER BY Valor`
		);

		await q(
			'imPersonal: cuántos médicos tienen Matricula > 0',
			`SELECT COUNT(*) AS total_personal,
			        SUM(CASE WHEN Matricula > 0 THEN 1 ELSE 0 END) AS con_matricula,
			        COUNT(DISTINCT Matricula) AS matriculas_distintas
			 FROM dbo.imPersonal`
		);

		await q(
			'imPersonal: ¿existen matrículas duplicadas?',
			`SELECT TOP 10 Matricula, COUNT(*) AS cant
			 FROM dbo.imPersonal
			 WHERE Matricula > 0
			 GROUP BY Matricula
			 HAVING COUNT(*) > 1
			 ORDER BY cant DESC`
		);

		// ────────────── imTurnos: catálogos ──────────────
		await q(
			'imTurnos: DISTINCT Status (con conteo)',
			`SELECT Status, COUNT(*) AS cant FROM dbo.imTurnos GROUP BY Status ORDER BY cant DESC`
		);

		await q(
			'imTurnos: DISTINCT TipoTurno (con conteo)',
			`SELECT TipoTurno, COUNT(*) AS cant FROM dbo.imTurnos GROUP BY TipoTurno ORDER BY cant DESC`
		);

		await q(
			'imTurnos: DISTINCT Sector (top 20)',
			`SELECT TOP 20 Sector, COUNT(*) AS cant FROM dbo.imTurnos GROUP BY Sector ORDER BY cant DESC`
		);

		// ────────────── imPersonalNoHorarios: catálogo motivos ──────────────
		await q(
			'imPersonalNoHorarios: DISTINCT MotivodeEsepcion (con conteo)',
			`SELECT MotivodeEsepcion, COUNT(*) AS cant
			 FROM dbo.imPersonalNoHorarios
			 GROUP BY MotivodeEsepcion
			 ORDER BY cant DESC`
		);

		// ────────────── ¿hay tabla catálogo de motivos? ──────────────
		await q(
			'Tablas que podrían ser catálogos relacionados',
			`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_NAME IN ('imMotivosNoHorarios','imMotivos','imMotivosExcepcion','imConsultorios','imServicios','imEspecialidades','imSectores','imTipoTurno','imStatusTurno','imEstadoTurno')
			 ORDER BY TABLE_NAME`
		);

		// ────────────── imPersonalHorarios: Dia vacío y catálogos ──────────────
		await q(
			'imPersonalHorarios: distribución por Dia',
			`SELECT Dia, COUNT(*) AS cant FROM dbo.imPersonalHorarios GROUP BY Dia ORDER BY cant DESC`
		);

		await q(
			'imPersonalHorarios: DISTINCT IDConsultorio (top 20)',
			`SELECT TOP 20 IDConsultorio, COUNT(*) AS cant
			 FROM dbo.imPersonalHorarios GROUP BY IDConsultorio ORDER BY cant DESC`
		);

		await q(
			'imPersonalHorarios: DISTINCT IdServicio (top 20)',
			`SELECT TOP 20 IdServicio, COUNT(*) AS cant
			 FROM dbo.imPersonalHorarios GROUP BY IdServicio ORDER BY cant DESC`
		);

		await q(
			'imPersonalHorarios: distribución de IntervaloConsulta (Clarion TIME)',
			`SELECT IntervaloConsulta, COUNT(*) AS cant
			 FROM dbo.imPersonalHorarios
			 GROUP BY IntervaloConsulta
			 ORDER BY cant DESC`
		);

		// ────────────── ¿Matrícula de imTurnos.Profesional aparece en imPersonal? ──────────────
		await q(
			'imTurnos.Profesional: ¿matchea con imPersonal.Matricula?',
			`SELECT
			    COUNT(DISTINCT t.Profesional) AS profesionales_distintos_en_turnos,
			    SUM(CASE WHEN p.Matricula IS NOT NULL THEN 1 ELSE 0 END) AS matchean_en_imPersonal
			 FROM (SELECT DISTINCT Profesional FROM dbo.imTurnos WHERE Profesional > 0) t
			 LEFT JOIN dbo.imPersonal p ON p.Matricula = t.Profesional`
		);

		process.exit(0);
	} catch (e) {
		console.error('Error general:', e.message);
		process.exit(1);
	}
})();
