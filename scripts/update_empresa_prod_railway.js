/**
 * Apunta empresa 1 en MySQL Railway al SQL Server de producción.
 * Uso: node scripts/update_empresa_prod_railway.js
 */
require('dotenv').config();
const { encrypt } = require('../src/utils/dbCrypto');
const { getAuthCentralPool } = require('../src/config/authCentralDb');

const PROD = {
	DbServer: process.env.PROD_DB_SERVER || '181.4.71.230',
	DbPort: Number(process.env.PROD_DB_PORT || 1433),
	DbName: process.env.PROD_DB_NAME || 'isource',
	DbUser: process.env.PROD_DB_USER || 'sa',
	DbPassword: process.env.PROD_DB_PASSWORD || 'isource',
};

async function ensureColumn(pool, column, ddl) {
	const [rows] = await pool.query(
		`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = ?`,
		[column],
	);
	if (Number(rows[0]?.n || 0) === 0) {
		await pool.query(`ALTER TABLE Empresas ${ddl}`);
		console.log(`• Columna ${column} creada`);
	}
}

(async () => {
	process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';
	if (!process.env.AUTH_DB_HOST && !process.env.MYSQLHOST) {
		console.error('Faltan AUTH_DB_* — exportá credenciales Railway MySQL o usá .env.railway');
		process.exit(1);
	}

	const pool = await getAuthCentralPool();
	await ensureColumn(pool, 'DbPort', 'ADD COLUMN DbPort INT NULL');
	await ensureColumn(pool, 'DbInstance', 'ADD COLUMN DbInstance VARCHAR(120) NULL');

	const enc = encrypt(PROD.DbPassword);
	await pool.query(
		`UPDATE Empresas SET
		   DbServer = ?,
		   DbPort = ?,
		   DbInstance = NULL,
		   DbName = ?,
		   DbUser = ?,
		   DbPasswordEnc = ?
		 WHERE IDEMPRESA = 1`,
		[PROD.DbServer, PROD.DbPort, PROD.DbName, PROD.DbUser, enc],
	);

	const [rows] = await pool.query(
		`SELECT IDEMPRESA, DESCRIPCION, DbServer, DbPort, DbName, DbUser,
		        LENGTH(DbPasswordEnc) AS pwdEncLen
		 FROM Empresas WHERE IDEMPRESA = 1`,
	);
	console.log('Empresa 1 actualizada:', rows[0]);
	console.log('\nEjecutá: node scripts/setup_whatsapp_bot.js prod');
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
