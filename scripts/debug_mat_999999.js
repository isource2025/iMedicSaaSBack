const db = require('../src/models/db');

(async () => {
	const r = await db.executeQuery(
		`SELECT TOP 8 fp.Valor, fp.NumeroVisita, fp.FechaPractica, LTRIM(RTRIM(fp.ValorSector)) AS Sector,
		        f.Matricula AS FprofMat, f.CodOperador, t.Profesional AS TurnoProf,
		        per.ApellidoNombre AS NombreFprof, med.ApellidoNombre AS NombreTurno
		 FROM dbo.imFacPracticas fp
		 JOIN dbo.imFacProfesionales f ON f.Valor = fp.Valor
		 LEFT JOIN dbo.imTurnos t ON t.NumeroVisita = fp.NumeroVisita
		 LEFT JOIN dbo.imPersonal per ON per.Matricula = f.Matricula
		 LEFT JOIN dbo.imPersonal med ON med.Matricula = t.Profesional
		 WHERE f.Matricula = 999999 OR (t.Profesional IS NOT NULL AND f.Matricula <> t.Profesional)
		 ORDER BY fp.Valor DESC`,
	);
	console.log(JSON.stringify(r, null, 2));
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
