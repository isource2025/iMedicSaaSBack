const db = require('../src/models/db');

(async () => {
	const pr = await db.executeQuery(
		`SELECT TOP 5 fp.Valor, fp.NumeroVisita, fp.Practica, fp.FechaPractica, fp.HoraPracticaInicio,
		        fp.CodOperador, LTRIM(RTRIM(fp.ValorSector)) AS Sector
		 FROM dbo.imFacPracticas fp
		 WHERE fp.Practica = 420101 AND LTRIM(RTRIM(fp.ValorSector)) = 'ANE'
		 ORDER BY fp.Valor DESC`,
	);
	for (const p of pr) {
		const nv = p.NumeroVisita;
		const fprof = await db.executeQuery(
			`SELECT fprof.*, per.ApellidoNombre, per.Matricula AS PerMatricula, per.Valor AS PerValor
			 FROM dbo.imFacProfesionales fprof
			 LEFT JOIN dbo.imPersonal per ON per.Matricula = fprof.Matricula
			 WHERE fprof.Valor = @p0`,
			[{ value: p.Valor, type: 'Int' }],
		);
		const turno = await db.executeQuery(
			`SELECT IdTurno, Profesional, NumeroVisita FROM dbo.imTurnos WHERE NumeroVisita = @p0`,
			[{ value: nv, type: 'Int' }],
		);
		const visita = await db.executeQuery(
			`SELECT NUMEROVISITA, DOCTORADMISOR, DOCTORASISTIENDO, OperadorEgreso, OPERADOR
			 FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
			[{ value: nv, type: 'Int' }],
		);
		const medTurno = turno[0]?.Profesional;
		const medPer = await db.executeQuery(
			`SELECT Matricula, ApellidoNombre FROM dbo.imPersonal WHERE Matricula = @p0`,
			[{ value: medTurno, type: 'Int' }],
		);
		console.log('\n--- Practica Valor', p.Valor, 'Visita', nv, '---');
		console.log('imFacProfesionales:', JSON.stringify(fprof[0], null, 2));
		console.log('imTurnos.Profesional:', medTurno, '->', medPer[0]?.ApellidoNombre);
		console.log('imVisita doctors:', visita[0]);
	}
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
