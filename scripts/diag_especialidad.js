/** Por qué los turnos quedan sin especialidad. Solo lectura. */
require('dotenv').config();
const db = require('../src/models/db');
const { runWithTenant } = require('../src/context/tenantContext');
const { convertirFechaAClarion, fechaIsoOffsetArgentina } = require('../src/utils/dateUtils');

const DIAS = 30;

async function q(label, sql) {
	console.log(`\n--- ${label} ---`);
	try {
		const rows = await db.executeQuery(sql);
		if (!rows.length) return console.log('(sin filas)');
		console.table(rows);
	} catch (e) {
		console.log(`ERROR: ${e.message}`);
	}
}

(async () => {
	await runWithTenant(1, async () => {
		const desdeC = convertirFechaAClarion(fechaIsoOffsetArgentina(-DIAS));
		const hastaC = convertirFechaAClarion(fechaIsoOffsetArgentina(0));
		const rango = `t.FechaAsignada BETWEEN ${desdeC} AND ${hastaC} AND ISNULL(t.IDPaciente,0) > 0`;

		await q(
			'imPersonal: columnas',
			`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_NAME='imPersonal' AND COLUMN_NAME IN
			 ('Valor','Matricula','ApellidoNombre','ValorEspecialidad','Especialidad')`,
		);

		await q(
			'Turnos sin especialidad: ¿qué profesionales son y resuelve imPersonal?',
			`SELECT TOP 20
			   t.Profesional,
			   MAX(LTRIM(RTRIM(ISNULL(t.Sector,'')))) AS Sector,
			   COUNT(*) AS Turnos,
			   MAX(p.ApellidoNombre) AS Nombre,
			   MAX(p.Valor) AS PersonalValor,
			   MAX(p.Matricula) AS PersonalMatricula,
			   MAX(p.ValorEspecialidad) AS ValorEspecialidad
			 FROM dbo.imTurnos t
			 OUTER APPLY (
			   SELECT TOP 1 * FROM dbo.imPersonal p2
			   WHERE p2.Matricula = t.Profesional OR p2.Valor = t.Profesional
			   ORDER BY p2.Valor
			 ) p
			 WHERE ${rango} AND ISNULL(t.Especialidad,0) = 0
			 GROUP BY t.Profesional
			 ORDER BY COUNT(*) DESC`,
		);

		await q(
			'¿Cuántos turnos tienen Especialidad=0 y se pueden recuperar vía profesional?',
			`SELECT
			   COUNT(*) AS TurnosSinEspecialidad,
			   SUM(CASE WHEN ISNULL(p.ValorEspecialidad,0) > 0 THEN 1 ELSE 0 END) AS RecuperablesPorProfesional
			 FROM dbo.imTurnos t
			 OUTER APPLY (
			   SELECT TOP 1 p2.ValorEspecialidad FROM dbo.imPersonal p2
			   WHERE p2.Matricula = t.Profesional OR p2.Valor = t.Profesional
			   ORDER BY p2.Valor
			 ) p
			 WHERE ${rango} AND ISNULL(t.Especialidad,0) = 0`,
		);

		await q(
			'Sector como respaldo: ¿los turnos sin especialidad se concentran en pocos sectores?',
			`SELECT TOP 15
			   LTRIM(RTRIM(ISNULL(t.Sector,''))) AS Sector,
			   MAX(s.Descripcion) AS Descripcion,
			   COUNT(*) AS SinEspecialidad
			 FROM dbo.imTurnos t
			 LEFT JOIN dbo.imSectores s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(ISNULL(t.Sector,'')))
			 WHERE ${rango} AND ISNULL(t.Especialidad,0) = 0
			 GROUP BY LTRIM(RTRIM(ISNULL(t.Sector,'')))
			 ORDER BY COUNT(*) DESC`,
		);
	});
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
