const db = require('../src/models/db');
(async () => {
	try {
		const r1 = await db.executeQuery(
			"SELECT COLUMNPROPERTY(OBJECT_ID('dbo.imTurnos'),'IdTurno','IsIdentity') AS IsIdent",
		);
		const r2 = await db.executeQuery('SELECT MAX(IdTurno) AS m FROM dbo.imTurnos');
		console.log('IsIdent:', r1[0]);
		console.log('Max IdTurno:', r2[0]);
		process.exit(0);
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
})();
