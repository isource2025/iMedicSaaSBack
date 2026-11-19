/*
  MiSalud.Imedic (S4) — usuario SQL Server de SOLO LECTURA para el portal del
  paciente, en la base clínica de UNA clínica.

  Qué hace:
    1. Crea (o actualiza la contraseña de) el login `misalud_portal_ro`.
    2. Crea el usuario en la base clínica y el rol `misalud_lectura`.
    3. Da SELECT solo sobre las tablas que lee el portal (las que no existen en
       esta base se saltean) y EXECUTE sobre las funciones de fecha Clarion.
    4. Niega INSERT/UPDATE/DELETE/ALTER sobre el esquema dbo.
  No usa db_datareader: el portal NO ve facturación, enfermería, insumos ni
  tablas de personal/contraseñas.

  Cómo correrlo (SSMS o sqlcmd, con un login sysadmin / securityadmin + db_owner):
    1. Cambiar @Password (mín. 16 caracteres, generada al azar) y @BaseClinica.
    2. Dejar @IncluirFase2 = 0 para el MVP; 1 cuando se publiquen laboratorio,
       estudios, protocolos y turnos.
    3. Ejecutar todo el script. Es idempotente: se puede volver a correr.
    4. Guardar la contraseña en el gestor de secretos / variables de MiSaludBack
       (nunca en Empresas ni en el repo).
  Reversión: ver bloque "Baja" al final.
*/
SET NOCOUNT ON;

DECLARE @Login        sysname       = N'misalud_portal_ro';
DECLARE @Password     nvarchar(128) = N'CAMBIAR_POR_PASSWORD_FUERTE';
DECLARE @BaseClinica  sysname       = N'NOMBRE_BASE_CLINICA';  -- la de Empresas.DbName
DECLARE @IncluirFase2 bit           = 0;

IF @Password = N'CAMBIAR_POR_PASSWORD_FUERTE' OR LEN(@Password) < 16
BEGIN
	RAISERROR(N'Definí @Password (mínimo 16 caracteres) antes de correr el script.', 16, 1);
	RETURN;
END;
IF DB_ID(@BaseClinica) IS NULL
BEGIN
	RAISERROR(N'La base %s no existe en este servidor.', 16, 1, @BaseClinica);
	RETURN;
END;

/* ---------------------------------------------------------------- login */
DECLARE @sql nvarchar(max);
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @Login)
BEGIN
	SET @sql = N'CREATE LOGIN ' + QUOTENAME(@Login) + N' WITH PASSWORD = ' + QUOTENAME(@Password, '''')
		+ N', DEFAULT_DATABASE = ' + QUOTENAME(@BaseClinica) + N', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;';
	EXEC (@sql);
	PRINT N'Login creado: ' + @Login;
END
ELSE
BEGIN
	SET @sql = N'ALTER LOGIN ' + QUOTENAME(@Login) + N' WITH PASSWORD = ' + QUOTENAME(@Password, '''') + N';';
	EXEC (@sql);
	PRINT N'Login existente: contraseña actualizada.';
END;

/* ------------------------------------------- usuario, rol y permisos (en la base) */
DECLARE @tablas nvarchar(max) = N'
	imPacientes,imSexo,imClientes,
	imVisita,imServiciosMedicos,imDiagnosticos,Sucursales,imCentroAsistencial,
	imHCI,imHCEpicrisis,
	imPedidosEstudiosAdjuntos,hctiposimagenes';
DECLARE @tablasFase2 nvarchar(max) = N'
	imHCEvolucion,
	imPedidosEstudios,imTiposPedidosEstudios,imSolicitudesEstudios,
	imHCExamenesLabCabecera,imHCExamenesLabDetalle,imHCExamenesLabDetalleConf,
	HCProtocolosPtes,imProtocolosResultados,
	imTurnos,imEspecialidades';
DECLARE @funciones nvarchar(max) = N'fn_ClarionDATE2SQL';

-- Lista -> tabla temporal (sin STRING_SPLIT: hay clínicas con SQL Server 2008/2012).
IF OBJECT_ID(N'tempdb..#objetos') IS NOT NULL DROP TABLE #objetos;
CREATE TABLE #objetos (nombre sysname NOT NULL, tipo char(1) NOT NULL);  -- T tabla, F función
DECLARE @lista nvarchar(max), @tipo char(1), @pos int, @item nvarchar(256), @vuelta int = 1;
WHILE @vuelta <= 3
BEGIN
	SELECT @lista = CASE @vuelta WHEN 1 THEN @tablas WHEN 2 THEN CASE WHEN @IncluirFase2 = 1 THEN @tablasFase2 ELSE N'' END ELSE @funciones END,
	       @tipo  = CASE WHEN @vuelta = 3 THEN 'F' ELSE 'T' END;
	SET @lista = REPLACE(REPLACE(REPLACE(@lista, CHAR(9), N''), CHAR(10), N''), CHAR(13), N'') + N',';
	WHILE LEN(@lista) > 0
	BEGIN
		SET @pos = CHARINDEX(N',', @lista);
		SET @item = LTRIM(RTRIM(LEFT(@lista, @pos - 1)));
		SET @lista = SUBSTRING(@lista, @pos + 1, LEN(@lista));
		IF @item <> N'' INSERT INTO #objetos (nombre, tipo) VALUES (@item, @tipo);
	END;
	SET @vuelta = @vuelta + 1;
END;

SET @sql = N'
USE ' + QUOTENAME(@BaseClinica) + N';
DECLARE @login sysname = @pLogin;
DECLARE @s nvarchar(max), @t sysname, @k char(1);

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @login)
BEGIN
	SET @s = N''CREATE USER '' + QUOTENAME(@login) + N'' FOR LOGIN '' + QUOTENAME(@login) + N'' WITH DEFAULT_SCHEMA = dbo;'';
	EXEC (@s);
END;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N''misalud_lectura'' AND type = ''R'')
	CREATE ROLE misalud_lectura;
IF IS_ROLEMEMBER(N''misalud_lectura'', @login) = 0
	EXEC sp_addrolemember N''misalud_lectura'', @login;
-- Por si alguien lo agregó a roles amplios a mano.
IF IS_ROLEMEMBER(N''db_datareader'', @login) = 1 EXEC sp_droprolemember N''db_datareader'', @login;
IF IS_ROLEMEMBER(N''db_datawriter'', @login) = 1 EXEC sp_droprolemember N''db_datawriter'', @login;
IF IS_ROLEMEMBER(N''db_owner'', @login) = 1 EXEC sp_droprolemember N''db_owner'', @login;

-- Sin CONTROL ni EXECUTE: un DENY a nivel esquema le gana a los GRANT por tabla/función.
DENY INSERT, UPDATE, DELETE, ALTER, TAKE OWNERSHIP ON SCHEMA::dbo TO misalud_lectura;

DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT nombre, tipo FROM #objetos;
OPEN c;
FETCH NEXT FROM c INTO @t, @k;
WHILE @@FETCH_STATUS = 0
BEGIN
	IF @k = ''T'' AND OBJECT_ID(N''dbo.'' + @t, N''U'') IS NOT NULL
	BEGIN
		SET @s = N''GRANT SELECT ON dbo.'' + QUOTENAME(@t) + N'' TO misalud_lectura;'';
		EXEC (@s);
		PRINT N''  SELECT dbo.'' + @t;
	END
	ELSE IF @k = ''F'' AND OBJECT_ID(N''dbo.'' + @t, N''FN'') IS NOT NULL
	BEGIN
		SET @s = N''GRANT EXECUTE ON dbo.'' + QUOTENAME(@t) + N'' TO misalud_lectura;'';
		EXEC (@s);
		PRINT N''  EXECUTE dbo.'' + @t;
	END
	ELSE IF @k = ''F'' AND (OBJECT_ID(N''dbo.'' + @t, N''IF'') IS NOT NULL OR OBJECT_ID(N''dbo.'' + @t, N''TF'') IS NOT NULL)
	BEGIN
		SET @s = N''GRANT SELECT ON dbo.'' + QUOTENAME(@t) + N'' TO misalud_lectura;'';
		EXEC (@s);
		PRINT N''  SELECT (función tabla) dbo.'' + @t;
	END
	ELSE
		PRINT N''  (no existe en esta base, se saltea) dbo.'' + @t;
	FETCH NEXT FROM c INTO @t, @k;
END;
CLOSE c; DEALLOCATE c;
';

EXEC sp_executesql @sql, N'@pLogin sysname', @pLogin = @Login;

PRINT N'Listo. Verificar con el bloque de abajo.';
GO

/* ------------------------------------------------------------ verificación
   Correr en la base clínica. Las dos primeras consultas tienen que funcionar;
   el INSERT y el SELECT de facturación tienen que fallar con "permission denied".

USE [NOMBRE_BASE_CLINICA];
EXECUTE AS USER = N'misalud_portal_ro';
SELECT TOP 1 * FROM dbo.imPacientes;
SELECT TOP 1 * FROM dbo.imVisita;
-- Tiene que fallar:
-- INSERT INTO dbo.imSexo DEFAULT VALUES;
-- SELECT TOP 1 * FROM <cualquier tabla de facturación o personal>;
REVERT;

-- Permisos efectivos del rol:
SELECT OBJECT_NAME(major_id) AS objeto, permission_name, state_desc
FROM sys.database_permissions
WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'misalud_lectura')
ORDER BY objeto, permission_name;
*/

/* ------------------------------------------------------------------- baja
USE [NOMBRE_BASE_CLINICA];
IF DATABASE_PRINCIPAL_ID(N'misalud_portal_ro') IS NOT NULL DROP USER [misalud_portal_ro];
IF DATABASE_PRINCIPAL_ID(N'misalud_lectura') IS NOT NULL DROP ROLE [misalud_lectura];
USE [master];
IF SUSER_ID(N'misalud_portal_ro') IS NOT NULL DROP LOGIN [misalud_portal_ro];
*/
