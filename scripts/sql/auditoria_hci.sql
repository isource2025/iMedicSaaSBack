/*
================================================================================
  iMedic — Auditoría de dbo.imHCI (historia clínica de ingreso)
================================================================================
  Crea dbo.imHCIAuditoria y el trigger dbo.TR_imHCI_Auditoria, que registra
  alta, modificación campo por campo y borrado completo de las HC, con usuario,
  aplicación y host. Vale para los dos clientes que escriben la tabla: la web y
  el Clarion.

  Idempotente: la tabla se crea si falta y el trigger se regenera siempre a
  partir del esquema real de imHCI, así que agregar columnas no lo deja viejo.

  Uso SSMS:
    USE [NombreDeTuBD];
    Ejecutar este archivo completo (F5)

  Uso Node (todas las empresas del catálogo, con prueba de verificación):
    node scripts/instalar_auditoria_hci.js --todas
================================================================================
*/

SET NOCOUNT ON;

/*------------------------------------------------------------------------------
  1) Tabla de historial

  IdAuditoria es UNIQUEIDENTIFIER y NO IDENTITY a propósito: el driver ODBC de
  Clarion lee el autonumérico de imHCI con SELECT @@IDENTITY, que devuelve el
  último IDENTITY insertado en la sesión, incluido el de un trigger. Con IDENTITY
  acá, Clarion se quedaría con el id de la auditoría en lugar del de la HC.
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imHCIAuditoria', N'U') IS NULL
BEGIN
	CREATE TABLE dbo.imHCIAuditoria (
		IdAuditoria   UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_imHCIAuditoria_Id DEFAULT NEWSEQUENTIALID(),
		IdHCIngreso   INT              NOT NULL,
		NumeroVisita  INT              NULL,
		Accion        CHAR(1)          NOT NULL,  -- I alta / U modificación / D borrado / E error de auditoría
		FechaHora     DATETIME2(3)     NOT NULL CONSTRAINT DF_imHCIAuditoria_Fecha DEFAULT SYSDATETIME(),
		Lote          UNIQUEIDENTIFIER NOT NULL,  -- agrupa los campos tocados por una misma sentencia
		Origen        VARCHAR(10)      NOT NULL,  -- WEB (con usuario) / DIRECTO (Clarion, SSMS, scripts)
		Usuario       VARCHAR(115)     NULL,
		IdOperador    INT              NULL,      -- imPassword.CodOperador
		LoginSql      VARCHAR(128)     NULL,
		Aplicacion    VARCHAR(128)     NULL,
		Host          VARCHAR(128)     NULL,
		Columna       VARCHAR(128)     NULL,      -- NULL en la fila marcadora de alta/borrado
		ValorAnterior VARCHAR(MAX)     NULL,
		ValorNuevo    VARCHAR(MAX)     NULL,
		CONSTRAINT PK_imHCIAuditoria PRIMARY KEY (IdAuditoria),
		CONSTRAINT CK_imHCIAuditoria_Accion CHECK (Accion IN ('I', 'U', 'D', 'E'))
	);

	CREATE INDEX IX_imHCIAuditoria_HC    ON dbo.imHCIAuditoria (IdHCIngreso, FechaHora);
	CREATE INDEX IX_imHCIAuditoria_Fecha ON dbo.imHCIAuditoria (FechaHora);
	CREATE INDEX IX_imHCIAuditoria_Lote  ON dbo.imHCIAuditoria (Lote);

	PRINT 'Creada: dbo.imHCIAuditoria';
END
ELSE
	PRINT 'Ya existía: dbo.imHCIAuditoria';

/*------------------------------------------------------------------------------
  2) Trigger

  Se arma por generación de código porque compara columna por columna para
  guardar solo lo que cambió. Los tipos LOB legacy (text/ntext/image) quedan
  afuera: no viajan en las tablas inserted/deleted de un trigger.
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imHCI', N'U') IS NULL
BEGIN
	PRINT 'AVISO: no existe dbo.imHCI, no se crea la auditoría.';
	RETURN;
END

DECLARE @listaDiff NVARCHAR(MAX), @listaPrev NVARCHAR(MAX), @sql NVARCHAR(MAX);
DECLARE @vigiladas INT, @afuera INT;
DECLARE @salto NVARCHAR(4) = NCHAR(13) + NCHAR(10);

-- IdHCIngreso queda afuera: es IDENTITY, no puede cambiar, y ya viaja como clave.
;WITH cols AS (
	SELECT
		c.COLUMN_NAME AS nombre,
		CASE WHEN c.DATA_TYPE IN ('datetime', 'smalldatetime', 'datetime2', 'date', 'time')
			THEN N', 121' ELSE N'' END AS estilo,
		c.ORDINAL_POSITION AS orden
	FROM INFORMATION_SCHEMA.COLUMNS c
	WHERE c.TABLE_SCHEMA = 'dbo'
	  AND c.TABLE_NAME = 'imHCI'
	  AND c.COLUMN_NAME <> 'IdHCIngreso'
	  AND c.DATA_TYPE NOT IN ('text', 'ntext', 'image', 'xml', 'binary', 'varbinary',
	                          'timestamp', 'sql_variant', 'geography', 'geometry', 'hierarchyid')
)
SELECT
	@listaDiff = (
		SELECT N',' + @salto + N'				(''' + nombre + N''', '
			+ N'CONVERT(VARCHAR(8000), d.[' + nombre + N']' + estilo + N'), '
			+ N'CONVERT(VARCHAR(8000), i.[' + nombre + N']' + estilo + N'))'
		FROM cols ORDER BY orden
		FOR XML PATH(''), TYPE
	).value('.', 'NVARCHAR(MAX)'),
	@listaPrev = (
		SELECT N',' + @salto + N'				(''' + nombre + N''', '
			+ N'CONVERT(VARCHAR(8000), d.[' + nombre + N']' + estilo + N'))'
		FROM cols ORDER BY orden
		FOR XML PATH(''), TYPE
	).value('.', 'NVARCHAR(MAX)'),
	@vigiladas = (SELECT COUNT(*) FROM cols);

SELECT @afuera = COUNT(*)
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imHCI'
  AND DATA_TYPE IN ('text', 'ntext', 'image', 'xml', 'binary', 'varbinary',
                    'timestamp', 'sql_variant', 'geography', 'geometry', 'hierarchyid');

IF @vigiladas IS NULL OR @vigiladas = 0
BEGIN
	PRINT 'AVISO: no pude leer las columnas de dbo.imHCI, no se creó el trigger.';
	RETURN;
END

-- Cada fila arranca con ',' + salto de línea; a la primera le sobra la coma.
SET @listaDiff = STUFF(@listaDiff, 1, 1, N'');
SET @listaPrev = STUFF(@listaPrev, 1, 1, N'');

SET @sql = N'
CREATE TRIGGER dbo.TR_imHCI_Auditoria
ON dbo.imHCI
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
	-- NOCOUNT: que el cliente (Clarion) no reciba los rowcount de la auditoría.
	SET NOCOUNT ON;
	-- Sin esto, con XACT_ABORT ON del cliente, un error acá deja la transacción
	-- condenada y tira abajo el guardado de la HC.
	SET XACT_ABORT OFF;

	DECLARE @hayNuevas BIT = CASE WHEN EXISTS (SELECT 1 FROM inserted) THEN 1 ELSE 0 END;
	DECLARE @hayViejas BIT = CASE WHEN EXISTS (SELECT 1 FROM deleted)  THEN 1 ELSE 0 END;
	IF @hayNuevas = 0 AND @hayViejas = 0 RETURN;

	DECLARE @lote UNIQUEIDENTIFIER = NEWID();
	DECLARE @origen VARCHAR(10) = ''DIRECTO'';
	DECLARE @usuario VARCHAR(115) = NULL;
	DECLARE @idOperador INT = NULL;
	DECLARE @login VARCHAR(128) = SUSER_SNAME();
	DECLARE @app VARCHAR(128) = APP_NAME();
	DECLARE @host VARCHAR(128) = HOST_NAME();

	-- El backend web publica ''WEB:'' + CodOperador(8) + '':'' + usuario + ''|'' en
	-- CONTEXT_INFO, en el mismo batch del DML (ver src/utils/auditoriaHci.js).
	-- El terminador ''|'' es necesario: CONTEXT_INFO vuelve rellenado con CHAR(0)
	-- hasta 128 bytes y en colación Modern_Spanish_CI_AS el CHAR(0) es un
	-- carácter ignorable, así que ni REPLACE ni CHARINDEX lo pueden recortar.
	DECLARE @ctx VARCHAR(128) = CONVERT(VARCHAR(128), CONTEXT_INFO());
	IF LEFT(@ctx, 4) = ''WEB:''
	BEGIN
		DECLARE @cod VARCHAR(8) = LTRIM(RTRIM(SUBSTRING(@ctx, 5, 8)));
		DECLARE @fin INT = CHARINDEX(''|'', @ctx);
		SET @origen = ''WEB'';
		SET @usuario = NULLIF(LTRIM(RTRIM(SUBSTRING(@ctx, 14,
			CASE WHEN @fin > 14 THEN @fin - 14 ELSE 0 END))), '''');
		-- Sin TRY_CONVERT: las BD están en nivel de compatibilidad 100.
		IF LEN(@cod) > 0 AND @cod NOT LIKE ''%[^0-9]%'' SET @idOperador = CONVERT(INT, @cod);
	END

	BEGIN TRY
		IF @hayNuevas = 1 AND @hayViejas = 1
		BEGIN
			-- Modificación: solo las columnas que cambiaron. COLLATE binario para
			-- no dejar pasar cambios de mayúsculas o acentos.
			INSERT INTO dbo.imHCIAuditoria (IdHCIngreso, NumeroVisita, Accion, Lote, Origen,
				Usuario, IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo)
			SELECT i.IdHCIngreso, i.NumeroVisita, ''U'', @lote, @origen, @usuario, @idOperador,
			       @login, @app, @host, v.Columna, v.Anterior, v.Nuevo
			FROM inserted i
			INNER JOIN deleted d ON d.IdHCIngreso = i.IdHCIngreso
			CROSS APPLY (VALUES' + @listaDiff + N'
			) AS v (Columna, Anterior, Nuevo)
			WHERE (v.Anterior IS NULL AND v.Nuevo IS NOT NULL)
			   OR (v.Anterior IS NOT NULL AND v.Nuevo IS NULL)
			   OR v.Anterior <> v.Nuevo COLLATE Latin1_General_BIN2;
		END
		ELSE IF @hayNuevas = 1
		BEGIN
			-- Alta: solo el evento. Los valores iniciales están en la fila viva.
			INSERT INTO dbo.imHCIAuditoria (IdHCIngreso, NumeroVisita, Accion, Lote, Origen,
				Usuario, IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo)
			SELECT i.IdHCIngreso, i.NumeroVisita, ''I'', @lote, @origen, @usuario, @idOperador,
			       @login, @app, @host, NULL, NULL, NULL
			FROM inserted i;
		END
		ELSE
		BEGIN
			-- Borrado: el evento y todos los valores no vacíos, para poder rearmar la fila.
			INSERT INTO dbo.imHCIAuditoria (IdHCIngreso, NumeroVisita, Accion, Lote, Origen,
				Usuario, IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo)
			SELECT d.IdHCIngreso, d.NumeroVisita, ''D'', @lote, @origen, @usuario, @idOperador,
			       @login, @app, @host, NULL, NULL, NULL
			FROM deleted d;

			INSERT INTO dbo.imHCIAuditoria (IdHCIngreso, NumeroVisita, Accion, Lote, Origen,
				Usuario, IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo)
			SELECT d.IdHCIngreso, d.NumeroVisita, ''D'', @lote, @origen, @usuario, @idOperador,
			       @login, @app, @host, v.Columna, v.Anterior, NULL
			FROM deleted d
			CROSS APPLY (VALUES' + @listaPrev + N'
			) AS v (Columna, Anterior)
			WHERE NULLIF(v.Anterior, '''') IS NOT NULL;
		END
	END TRY
	BEGIN CATCH
		-- Perder la auditoría es malo; perder la HC es peor. Se deja rastro del
		-- fallo y no se propaga el error.
		IF XACT_STATE() <> -1
		BEGIN
			BEGIN TRY
				INSERT INTO dbo.imHCIAuditoria (IdHCIngreso, NumeroVisita, Accion, Lote, Origen,
					Usuario, IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo)
				VALUES (
					ISNULL((SELECT TOP 1 IdHCIngreso FROM inserted), (SELECT TOP 1 IdHCIngreso FROM deleted)),
					NULL, ''E'', @lote, @origen, @usuario, @idOperador, @login, @app, @host,
					''(error de auditoria)'', NULL, LEFT(ERROR_MESSAGE(), 4000)
				);
			END TRY
			BEGIN CATCH
			END CATCH
		END
	END CATCH
END';

-- El DROP recién acá: si algo falla al armar el código, la tabla no queda sin
-- auditoría por el camino.
IF OBJECT_ID(N'dbo.TR_imHCI_Auditoria', N'TR') IS NOT NULL
	DROP TRIGGER dbo.TR_imHCI_Auditoria;

EXEC sp_executesql @sql;

-- Un error dentro del SQL dinámico no corta este batch: hay que confirmarlo.
IF OBJECT_ID(N'dbo.TR_imHCI_Auditoria', N'TR') IS NULL
BEGIN
	RAISERROR('No se pudo crear dbo.TR_imHCI_Auditoria (ver el error anterior)', 16, 1);
	RETURN;
END

PRINT 'Creado: trigger dbo.TR_imHCI_Auditoria (' + CONVERT(VARCHAR(10), @vigiladas) + ' columnas vigiladas'
	+ CASE WHEN @afuera > 0 THEN N', ' + CONVERT(VARCHAR(10), @afuera) + N' de tipo LOB afuera' ELSE N'' END + ')';
