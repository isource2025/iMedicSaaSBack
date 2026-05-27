require('dotenv').config();
const { connectDB } = require('../src/config/database');

const TABLES = [
	'imPassword',
	'imPersonal',
	'imRoles',
	'imPermisos',
	'imRolPermisos',
	'imPersonalEmpresas',
	'imPersonalSectores',
	'imSectores',
	'imUsuarioEmpresaLogin',
	'EmpresasModuloPack',
	'imIVA',
	'Empresas',
];

(async () => {
	const pool = await connectDB();
	for (const table of TABLES) {
		const cols = await pool.request().input('table', table).query(`
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        DATETIME_PRECISION,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `);
		const pk = await pool.request().input('tablePk', table).query(`
      SELECT ku.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
        ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
       AND ku.TABLE_NAME = tc.TABLE_NAME
      WHERE tc.TABLE_SCHEMA = 'dbo'
        AND tc.TABLE_NAME = @tablePk
        AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY ku.ORDINAL_POSITION
    `);
		const count = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.${table}`);
		console.log(`\n## ${table} (${count.recordset[0].c})`);
		console.log(`PK: ${JSON.stringify((pk.recordset || []).map((r) => r.COLUMN_NAME))}`);
		console.log(JSON.stringify(cols.recordset, null, 2));
	}
	process.exit(0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
