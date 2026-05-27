const db = require('../src/models/db');

const nv = Number(process.argv[2] || 409964);

async function getResolver() {
	const cols = await db.executeQuery(
		`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VUnionModuladasNomenclador'`,
	);
	const set = new Set((cols || []).map((r) => String(r.COLUMN_NAME || '').trim().toLowerCase()));
	const pick = (candidates) => candidates.find((c) => set.has(c.toLowerCase())) || null;
	return { codeCol: pick(['Practica', 'CodigoPractica', 'Codigo', 'CodPractica', 'IdPractica', 'Valor']), descCol: pick(['DescPractica', 'DescripcionPractica', 'Descripcion', 'Prestacion', 'Denominacion', 'Detalle']) };
}

(async () => {
	const nomenclador = await getResolver();
	console.log('Resolver:', nomenclador);
	const joinNomenclador = nomenclador
		? `LEFT JOIN dbo.VUnionModuladasNomenclador n
         ON LTRIM(RTRIM(CONVERT(VARCHAR(50), fp.Practica))) = LTRIM(RTRIM(CONVERT(VARCHAR(50), n.[${nomenclador.codeCol}])))`
		: '';
	const practicaDescripcionSql = nomenclador
		? `COALESCE(
         NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(250), n.[${nomenclador.descCol}]))), ''),
         NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(250), fp.DescPractica))), ''),
         CONVERT(VARCHAR(50), fp.Practica)
       ) AS PracticaDescripcion`
		: `COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(250), fp.DescPractica))), ''), CONVERT(VARCHAR(50), fp.Practica)) AS PracticaDescripcion`;

	const rows = await db.executeQuery(
		`SELECT fp.Valor, fp.Practica, ${practicaDescripcionSql},
		        fp.CantidadPractica, fp.FechaPractica, fp.HoraPracticaInicio,
		        n.[${nomenclador.codeCol}] AS NomenCodigo
		 FROM dbo.imFacpracticas fp
		 ${joinNomenclador}
		 WHERE fp.NumeroVisita = @p0`,
		[{ value: nv, type: 'Int' }],
	);
	console.log('\n=== Query admissionSearch (rows:', rows.length, ') ===');
	console.log(JSON.stringify(rows, null, 2));

	// How many nomenclador rows match 420101?
	if (nomenclador) {
		const dup = await db.executeQuery(
			`SELECT TOP 20 [${nomenclador.codeCol}] AS Codigo, [${nomenclador.descCol}] AS Descripcion
			 FROM dbo.VUnionModuladasNomenclador n
			 WHERE LTRIM(RTRIM(CONVERT(VARCHAR(50), n.[${nomenclador.codeCol}]))) = '420101'`,
		);
		console.log('\n=== Nomenclador matches for 420101:', dup.length, '===');
		console.log(JSON.stringify(dup, null, 2));
	}
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
