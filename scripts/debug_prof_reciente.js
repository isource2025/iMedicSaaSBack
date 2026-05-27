const db = require('../src/models/db');
const s = require('../src/services/admissionSearch.service');

(async () => {
	const r = await db.executeQuery(
		`SELECT TOP 5 fp.NumeroVisita, fp.Valor, fp.FechaPractica
		 FROM dbo.imFacPracticas fp
		 WHERE fp.Practica = 420101 AND fp.FechaPractica >= 82300
		 ORDER BY fp.Valor DESC`,
	);
	for (const row of r) {
		const p = await s.obtenerPracticasPorVisita(row.NumeroVisita);
		const t = await db.executeQuery(
			`SELECT IdTurno, Profesional FROM dbo.imTurnos WHERE NumeroVisita = @p0`,
			[{ value: row.NumeroVisita, type: 'Int' }],
		);
		const fp = await db.executeQuery(
			`SELECT Matricula, CodOperador FROM dbo.imFacProfesionales WHERE Valor = @p0`,
			[{ value: row.Valor, type: 'Int' }],
		);
		console.log({
			nv: row.NumeroVisita,
			turnoProf: t[0]?.Profesional,
			fprofMat: fp[0]?.Matricula,
			fprofCodOp: fp[0]?.CodOperador,
			display: p[0]?.Profesionales,
		});
	}
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
