const db = require('../src/models/db');
const admissionSearch = require('../src/services/admissionSearch.service');

const nv = Number(process.argv[2] || 409964);

(async () => {
	const raw = await db.executeQuery(
		`SELECT fp.Valor, fp.NumeroVisita, fp.Practica, fp.TipoPractica, fp.CantidadPractica,
		        fp.FechaPractica, fp.HoraPracticaInicio, fp.ValorSector, fp.Estado
		 FROM dbo.imFacPracticas fp WHERE fp.NumeroVisita = @p0 ORDER BY fp.Valor`,
		[{ value: nv, type: 'Int' }],
	);
	console.log('\n=== imFacPracticas directo ===');
	console.log(JSON.stringify(raw, null, 2));

	const svc = require('../src/services/admissionSearch.service');
	// obtenerPracticasPorVisita is not exported - call via internal
	const rows = await db.executeQuery(
		`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imFacProfesionales'`,
	);
	console.log('\n=== imFacProfesionales columns sample ===', rows.map((r) => r.COLUMN_NAME).slice(0, 15));

	const prof = await db.executeQuery(
		`SELECT fp.Valor, fp.Practica, fprof.Matricula, fprof.Funcion,
		        p.ApellidoyNombre AS ProfesionalNombre
		 FROM dbo.imFacPracticas fp
		 LEFT JOIN dbo.imFacProfesionales fprof ON fprof.Valor = fp.Valor
		 LEFT JOIN dbo.imPersonal pers ON pers.Matricula = fprof.Matricula
		 LEFT JOIN dbo.imPacientes p ON 1=0
		 WHERE fp.NumeroVisita = @p0`,
		[{ value: nv, type: 'Int' }],
	);
	console.log('\n=== prof join (test) ===', JSON.stringify(prof, null, 2));

	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
