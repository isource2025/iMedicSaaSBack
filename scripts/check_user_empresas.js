require('dotenv').config();
const { connectDB } = require('../src/config/database');

const user = process.argv[2] || 'rocioac';

(async () => {
	const pool = await connectDB();
	const r = await pool.request().input('u', user).query(`
    SELECT pw.ValorPersonal, pe.IdEmpresa, e.DESCRIPCION
    FROM impassword pw
    LEFT JOIN imPersonalEmpresas pe ON pe.IdPersonal = pw.ValorPersonal
    LEFT JOIN Empresas e ON e.IDEMPRESA = pe.IdEmpresa
    WHERE UPPER(RTRIM(LTRIM(ISNULL(pw.NombreRed, pw.nombrered)))) = UPPER(RTRIM(LTRIM(@u)))
  `);
	console.log('imPersonalEmpresas:', r.recordset);
	const idx = await pool.request().input('u', user).query(`
    SELECT l.*, e.DESCRIPCION FROM imUsuarioEmpresaLogin l
    LEFT JOIN Empresas e ON e.IDEMPRESA = l.IdEmpresa
    WHERE UPPER(RTRIM(LTRIM(l.NombreRed))) = UPPER(RTRIM(LTRIM(@u)))
  `);
	console.log('indice login:', idx.recordset);
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
