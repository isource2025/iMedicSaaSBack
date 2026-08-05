/**
 * Superadmin local (SQL Server) cuando AUTH MySQL está off (LOCAL_DEV_ONLY).
 */
const passwordService = require('./password.service');
const { SA_USER, SA_PASS } = require('../config/tenantIdentity');
const { isLocalDevOnly } = require('../config/authCentralDb');

async function ensureLocalSqlSuperAdmin() {
	if (!isLocalDevOnly()) return { skipped: true };
	const { executeQuery } = require('../models/db');

	const existing = await executeQuery(
		`
    SELECT TOP 1 ValorPersonal, NombreRed, Password, Grupo
    FROM dbo.imPassword
    WHERE LOWER(LTRIM(RTRIM(CAST(NombreRed AS VARCHAR(100))))) = LOWER(@p0)
    `,
		[{ value: SA_USER, type: 'VarChar' }],
	).catch(() => []);

	const passOk =
		existing[0] &&
		(await passwordService.verifyPassword(SA_PASS, existing[0]));

	if (passOk) {
		return { ok: true, repaired: false, source: 'sql' };
	}

	if (existing[0]) {
		await executeQuery(
			`
      UPDATE dbo.imPassword
      SET Password = @p1, Grupo = 11, Nombres = 'Admin', Apellido = 'Super'
      WHERE ValorPersonal = @p0
      `,
			[
				{ value: existing[0].ValorPersonal },
				{ value: SA_PASS, type: 'VarChar' },
			],
		);
	} else {
		// Usar id alto que no choque con Clarion típico (<1e6)
		let vp = 1000001;
		const maxR = await executeQuery(
			`SELECT ISNULL(MAX(ValorPersonal), 0) AS m FROM dbo.imPassword WHERE ValorPersonal >= 1000000`,
		).catch(() => [{ m: 0 }]);
		const m = Number(maxR[0]?.m) || 0;
		if (m >= vp) vp = m + 1;

		await executeQuery(
			`
      INSERT INTO dbo.imPassword (ValorPersonal, NombreRed, Password, Grupo, Nombres, Apellido, CodOperador)
      VALUES (@p0, @p1, @p2, 11, 'Admin', 'Super', 999)
      `,
			[
				{ value: vp },
				{ value: SA_USER, type: 'VarChar' },
				{ value: SA_PASS, type: 'VarChar' },
			],
		).catch(async (e) => {
			// Esquema mínimo
			console.warn('[ensureLocalSqlSuperAdmin] insert full failed, retry min:', e.message);
			await executeQuery(
				`
        INSERT INTO dbo.imPassword (ValorPersonal, NombreRed, Password, Grupo)
        VALUES (@p0, @p1, @p2, 11)
        `,
				[
					{ value: vp },
					{ value: SA_USER, type: 'VarChar' },
					{ value: SA_PASS, type: 'VarChar' },
				],
			);
		});

		await executeQuery(
			`
      IF NOT EXISTS (SELECT 1 FROM dbo.imPersonal WHERE Valor = @p0)
        INSERT INTO dbo.imPersonal (Valor, Rol, ApellidoNombre, Matricula)
        VALUES (@p0, '5', 'Super, Admin Plataforma', @p0)
      ELSE
        UPDATE dbo.imPersonal SET Rol = '5' WHERE Valor = @p0
      `,
			[{ value: vp }],
		).catch(() => {});
	}

	// Asegurar rol SUPER_ADMIN / 5 en imRoles si existe
	await executeQuery(
		`
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imRoles')
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 5)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (5, 'SUPER_ADMIN', 'Administrador de plataforma', 200, 1)
      ELSE
        UPDATE dbo.imRoles SET Nombre = 'SUPER_ADMIN', Activo = 1, Nivel = 200 WHERE IdRol = 5
    END
    `,
	).catch(() => {});

	const check = await executeQuery(
		`
    SELECT TOP 1 ValorPersonal, NombreRed, Password, Grupo
    FROM dbo.imPassword
    WHERE LOWER(LTRIM(RTRIM(CAST(NombreRed AS VARCHAR(100))))) = LOWER(@p0)
    `,
		[{ value: SA_USER, type: 'VarChar' }],
	).catch(() => []);

	const ok =
		check[0] && (await passwordService.verifyPassword(SA_PASS, check[0]));
	console.log(
		`[ensureLocalSqlSuperAdmin] ${ok ? 'OK' : 'FAIL'} user=${SA_USER} (LOCAL SQL)`,
	);
	return { ok, repaired: true, source: 'sql', valor: check[0]?.ValorPersonal };
}

module.exports = { ensureLocalSqlSuperAdmin };
