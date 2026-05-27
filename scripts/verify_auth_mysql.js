require('dotenv').config();
const mysql = require('mysql2/promise');
const { authDbConfig } = require('../src/config/authCentralDb');

(async () => {
	const pool = await mysql.createPool(authDbConfig());

	const [columns] = await pool.query(`
    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'imPersonal'
    ORDER BY ORDINAL_POSITION
  `);

	const [sample] = await pool.query(`
    SELECT Valor, Matricula, ApellidoNombre, Domicilio, Telefono, email, Rol
    FROM imPersonal
    ORDER BY Valor
    LIMIT 10
  `);

	console.log('COLUMNS');
	console.log(JSON.stringify(columns, null, 2));
	console.log('\nSAMPLE');
	console.log(JSON.stringify(sample, null, 2));

	process.exit(0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
