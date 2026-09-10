/**
 * Superadmin local (SQL Server) cuando AUTH MySQL está off (LOCAL_DEV_ONLY).
 */
const passwordService = require('./password.service');
const {
	SA_USER,
	SA_PASS,
	PLATFORM_VALOR_MIN,
} = require('../config/tenantIdentity');
const { isLocalDevOnly } = require('../config/authCentralDb');
const { isLocalSqlHost } = require('../config/database');

async function asegurarRolSuperAdminPersonal(executeQuery, valorPersonal) {
	await executeQuery(
		`
    IF NOT EXISTS (SELECT 1 FROM dbo.imPersonal WHERE Valor = @p0)
      INSERT INTO dbo.imPersonal (Valor, Rol, ApellidoNombre, Matricula)
      VALUES (@p0, '5', 'Super, Admin Plataforma', @p0)
    ELSE
      UPDATE dbo.imPersonal SET Rol = '5' WHERE Valor = @p0
    `,
		[{ value: valorPersonal }],
	).catch(() => {});
}

async function nextPlatformValor(executeQuery) {
	let vp = Math.max(PLATFORM_VALOR_MIN + 1, 1000001);
	const maxR = await executeQuery(
		`SELECT ISNULL(MAX(ValorPersonal), 0) AS m FROM dbo.imPassword WHERE ValorPersonal >= @p0`,
		[{ value: PLATFORM_VALOR_MIN }],
	).catch(() => [{ m: 0 }]);
	const m = Number(maxR[0]?.m) || 0;
	if (m >= vp) vp = m + 1;
	return vp;
}

async function ensureLocalSqlSuperAdmin() {
	if (!isLocalDevOnly()) return { skipped: true };
	// LOCAL_DEV_ONLY admite apuntar al SQL de un hospital por VPN. Crear ahí la
	// cuenta de plataforma la mete dentro de los datos del tenant (y el sync la
	// sube a MySQL como usuario del hospital): solo escribir en SQL local.
	if (!isLocalSqlHost(process.env.DB_SERVER)) {
		console.warn(
			`[ensureLocalSqlSuperAdmin] omitido: DB_SERVER="${process.env.DB_SERVER}" no es local`,
		);
		return { skipped: true, reason: 'sql-remoto' };
	}
	const { executeQuery } = require('../models/db');

	const existing = await executeQuery(
		`
    SELECT TOP 1 ValorPersonal, NombreRed, Password, Grupo
    FROM dbo.imPassword
    WHERE LOWER(LTRIM(RTRIM(CAST(NombreRed AS VARCHAR(100))))) = LOWER(@p0)
    `,
		[{ value: SA_USER, type: 'VarChar' }],
	).catch(() => []);

	const row = existing[0];
	const vpExistente = row ? Number(row.ValorPersonal) : null;
	const esCuentaHospital =
		Number.isFinite(vpExistente) && vpExistente < PLATFORM_VALOR_MIN;

	// Username "superadmin" usurpado por un personal de hospital (p.ej. Vidal).
	if (row && esCuentaHospital) {
		await executeQuery(
			`
      UPDATE dbo.imPassword
      SET NombreRed = CONCAT('u', CAST(ValorPersonal AS VARCHAR(20)))
      WHERE ValorPersonal = @p0
        AND LOWER(LTRIM(RTRIM(CAST(NombreRed AS VARCHAR(100))))) = LOWER(@p1)
      `,
			[
				{ value: vpExistente },
				{ value: SA_USER, type: 'VarChar' },
			],
		).catch(() => {});
		console.warn(
			`[ensureLocalSqlSuperAdmin] liberó username ${SA_USER} del personal ${vpExistente}`,
		);
	}

	const plataforma = await executeQuery(
		`
    SELECT TOP 1 ValorPersonal, NombreRed, Password, Grupo
    FROM dbo.imPassword
    WHERE LOWER(LTRIM(RTRIM(CAST(NombreRed AS VARCHAR(100))))) = LOWER(@p0)
    `,
		[{ value: SA_USER, type: 'VarChar' }],
	).catch(() => []);

	let vp = plataforma[0] ? Number(plataforma[0].ValorPersonal) : null;
	if (!Number.isFinite(vp) || vp < PLATFORM_VALOR_MIN) {
		vp = await nextPlatformValor(executeQuery);
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
	} else {
		await executeQuery(
			`
      UPDATE dbo.imPassword
      SET Password = @p1, Grupo = 11, Nombres = 'Admin', Apellido = 'Super', NombreRed = @p2
      WHERE ValorPersonal = @p0
      `,
			[
				{ value: vp },
				{ value: SA_PASS, type: 'VarChar' },
				{ value: SA_USER, type: 'VarChar' },
			],
		);
	}

	await asegurarRolSuperAdminPersonal(executeQuery, vp);

	await executeQuery(
		`
    IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imRoles')
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 1)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (1, 'ADMIN', 'Administrador del sistema', 100, 1);
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 2)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (2, 'MEDICO', 'Médico / profesional de salud', 50, 1);
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 3)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (3, 'ENFERMERO', 'Personal de enfermería', 40, 1);
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 4)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (4, 'ADMINISTRATIVO', 'Personal administrativo', 20, 1);
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 5)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (5, 'SUPER_ADMIN', 'Administrador de plataforma', 200, 1)
      ELSE
        UPDATE dbo.imRoles SET Nombre = 'SUPER_ADMIN', Activo = 1, Nivel = 200 WHERE IdRol = 5;
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 6)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (6, 'CARGA_HC', 'Carga de adjuntos', 25, 1)
      ELSE
        UPDATE dbo.imRoles
        SET Nombre = 'CARGA_HC',
            Descripcion = 'Carga de adjuntos',
            Nivel = 25,
            Activo = 1
        WHERE IdRol = 6;
      IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 7)
        INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
        VALUES (7, 'PANEL_DATOS', 'Panel de datos', 15, 1)
      ELSE
        UPDATE dbo.imRoles
        SET Nombre = 'PANEL_DATOS',
            Descripcion = 'Panel de datos',
            Nivel = 15,
            Activo = 1
        WHERE IdRol = 7;
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
		`[ensureLocalSqlSuperAdmin] ${ok ? 'OK' : 'FAIL'} user=${SA_USER} vp=${check[0]?.ValorPersonal} (LOCAL SQL)`,
	);
	return { ok, repaired: true, source: 'sql', valor: check[0]?.ValorPersonal };
}

module.exports = { ensureLocalSqlSuperAdmin };
