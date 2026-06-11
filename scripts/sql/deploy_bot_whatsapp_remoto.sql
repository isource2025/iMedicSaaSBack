/*
  =============================================================================
  DEPLOY BOT WHATSAPP — SQL Server tenant (remoto / producción)
  =============================================================================
  Deja la BD exactamente como el entorno actual:
    - imBotConfig   (config clave/valor + claves WhatsApp)
    - imBotChat     (SESION | MSG | LOG — inbox unificado)
    - SIN tablas legacy: imBotConversacion, imBotMensaje, imBotTurnosLog

  La turnera NO crea tablas nuevas (usa imTurnos, imPersonalHorarios, etc.).

  Cómo ejecutar
  -------------
  SSMS / Azure Data Studio: abrir este archivo contra la BD tenant y ejecutar.
  Node (usa .env del backend):
    node scripts/ejecutar_deploy_bot_remoto.js

  Idempotente: se puede correr varias veces sin duplicar datos.
  =============================================================================
*/
SET NOCOUNT ON;
GO

PRINT '=== [1/6] imBotConfig ===';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConfig' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotConfig (
    IdConfig          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Clave             VARCHAR(50)       NOT NULL,
    Valor             NVARCHAR(MAX)     NULL,
    Tipo              VARCHAR(20)       NOT NULL CONSTRAINT DF_imBotConfig_Tipo DEFAULT 'string',
    Activo            BIT               NOT NULL CONSTRAINT DF_imBotConfig_Activo DEFAULT 1,
    FechaModificacion DATETIME          NOT NULL CONSTRAINT DF_imBotConfig_Fecha DEFAULT GETDATE()
  );
END
GO

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotConfig'
    AND COLUMN_NAME = 'Valor'
    AND (DATA_TYPE NOT IN ('nvarchar', 'varchar') OR CHARACTER_MAXIMUM_LENGTH <> -1)
)
  ALTER TABLE dbo.imBotConfig ALTER COLUMN Valor NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_imBotConfig_Clave' AND object_id = OBJECT_ID('dbo.imBotConfig'))
  CREATE UNIQUE INDEX UX_imBotConfig_Clave ON dbo.imBotConfig (Clave) WHERE Activo = 1;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'mensaje_bienvenida' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES
    ('mensaje_bienvenida', N'Hola, soy el asistente de turnos. Para comenzar indicá tu DNI (sin puntos).', 'string');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'requiere_renaper' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('requiere_renaper', 'true', 'bool');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'crear_paciente_automatico' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('crear_paciente_automatico', 'true', 'bool');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'anticipacion_min_horas' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('anticipacion_min_horas', '2', 'int');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'dias_max_antelacion' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('dias_max_antelacion', '60', 'int');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'max_turnos_por_paciente_dia' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('max_turnos_por_paciente_dia', '1', 'int');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'whatsapp_phone_number_id' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('whatsapp_phone_number_id', '', 'string');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'whatsapp_waba_id' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('whatsapp_waba_id', '', 'string');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'whatsapp_access_token_enc' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('whatsapp_access_token_enc', '', 'string');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'mensaje_agradecimiento' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES
    ('mensaje_agradecimiento', N'¡De nada! Si necesitás otro turno, escribinos cuando quieras.', 'string');
GO

PRINT '=== [2/6] imBotChat (crear si no existe) ===';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotChat' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotChat (
    IdRegistro         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Tipo               VARCHAR(10)       NOT NULL,
    IdSesion           VARCHAR(100)      NOT NULL,
    TelefonoWhatsApp   VARCHAR(20)       NULL,
    NombreContacto     VARCHAR(120)      NULL,
    IdPaciente         INT               NULL,
    DniPaciente        VARCHAR(20)       NULL,
    ModoControl        VARCHAR(20)       NULL CONSTRAINT DF_imBotChat_Modo DEFAULT 'BOT',
    PasoBot            VARCHAR(50)       NULL,
    ContextoBotJson    NVARCHAR(MAX)     NULL,
    IdAgente           INT               NULL,
    NombreAgente       VARCHAR(120)      NULL,
    NoLeidos           INT               NULL CONSTRAINT DF_imBotChat_NoLeidos DEFAULT 0,
    UltimoMensaje      NVARCHAR(500)     NULL,
    FechaUltimoMensaje DATETIME          NULL,
    SesionActiva       BIT               NULL CONSTRAINT DF_imBotChat_Activa DEFAULT 1,
    Direccion          VARCHAR(10)       NULL,
    Origen             VARCHAR(20)       NULL,
    Contenido          NVARCHAR(MAX)     NULL,
    EstadoEntrega      VARCHAR(20)       NULL,
    MetaMessageId      VARCHAR(100)      NULL,
    IdTurno            INT               NULL,
    AccionLog          VARCHAR(30)       NULL,
    PayloadJson        NVARCHAR(MAX)     NULL,
    ResultadoLog       VARCHAR(20)       NULL,
    MensajeErrorLog    VARCHAR(500)      NULL,
    FechaRegistro      DATETIME          NOT NULL CONSTRAINT DF_imBotChat_Fecha DEFAULT GETDATE(),
    CONSTRAINT CK_imBotChat_Tipo CHECK (Tipo IN ('SESION', 'MSG', 'LOG'))
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_imBotChat_Sesion' AND object_id = OBJECT_ID('dbo.imBotChat'))
  CREATE UNIQUE INDEX UX_imBotChat_Sesion
    ON dbo.imBotChat (IdSesion) WHERE Tipo = 'SESION';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imBotChat_Sesion_Ultimo' AND object_id = OBJECT_ID('dbo.imBotChat'))
  CREATE INDEX IX_imBotChat_Sesion_Ultimo
    ON dbo.imBotChat (FechaUltimoMensaje DESC, FechaRegistro DESC)
    WHERE Tipo = 'SESION' AND SesionActiva = 1;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imBotChat_Telefono' AND object_id = OBJECT_ID('dbo.imBotChat'))
  CREATE INDEX IX_imBotChat_Telefono
    ON dbo.imBotChat (TelefonoWhatsApp) WHERE Tipo = 'SESION';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imBotChat_Msg_Sesion_Fecha' AND object_id = OBJECT_ID('dbo.imBotChat'))
  CREATE INDEX IX_imBotChat_Msg_Sesion_Fecha
    ON dbo.imBotChat (IdSesion, FechaRegistro ASC, IdRegistro ASC)
    WHERE Tipo = 'MSG';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imBotChat_Log_Fecha' AND object_id = OBJECT_ID('dbo.imBotChat'))
  CREATE INDEX IX_imBotChat_Log_Fecha
    ON dbo.imBotChat (FechaRegistro DESC) WHERE Tipo = 'LOG';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imBotChat_MetaId' AND object_id = OBJECT_ID('dbo.imBotChat'))
  CREATE INDEX IX_imBotChat_MetaId
    ON dbo.imBotChat (MetaMessageId) WHERE Tipo = 'MSG' AND MetaMessageId IS NOT NULL;
GO

PRINT '=== [3/6] Migración legacy → imBotChat (idempotente) ===';
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConversacion')
BEGIN
  INSERT INTO dbo.imBotChat (
    Tipo, IdSesion, TelefonoWhatsApp, NombreContacto, IdPaciente, DniPaciente,
    ModoControl, PasoBot, ContextoBotJson, IdAgente, NombreAgente, NoLeidos,
    UltimoMensaje, FechaUltimoMensaje, SesionActiva, FechaRegistro
  )
  SELECT
    'SESION', c.IdConversacion, c.TelefonoWhatsApp, c.NombreContacto, c.IdPaciente, c.DniPaciente,
    c.ModoControl, c.PasoBot, c.ContextoBotJson, c.IdAgente, c.NombreAgente, c.NoLeidos,
    c.UltimoMensaje, c.FechaUltimoMensaje, c.Activo, ISNULL(c.FechaCreacion, GETDATE())
  FROM dbo.imBotConversacion c
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.imBotChat ch
    WHERE ch.Tipo = 'SESION' AND ch.IdSesion = c.IdConversacion
  );
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje')
BEGIN
  IF EXISTS (
    SELECT 1 FROM dbo.imBotMensaje m
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.imBotChat ch
      WHERE ch.Tipo = 'MSG' AND ch.IdRegistro = m.IdMensaje
    )
  )
  BEGIN
    SET IDENTITY_INSERT dbo.imBotChat ON;
    INSERT INTO dbo.imBotChat (
      IdRegistro, Tipo, IdSesion, Direccion, Origen, Contenido, EstadoEntrega,
      IdAgente, NombreAgente, MetaMessageId, FechaRegistro
    )
    SELECT
      m.IdMensaje, 'MSG', m.IdConversacion, m.Direccion, m.Origen, m.Contenido, m.EstadoEntrega,
      m.IdAgente, m.NombreAgente, m.MetaMessageId, m.FechaMensaje
    FROM dbo.imBotMensaje m
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.imBotChat ch
      WHERE ch.Tipo = 'MSG' AND ch.IdRegistro = m.IdMensaje
    )
    ORDER BY m.FechaMensaje ASC, m.IdMensaje ASC;
    SET IDENTITY_INSERT dbo.imBotChat OFF;
  END
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotTurnosLog')
BEGIN
  INSERT INTO dbo.imBotChat (
    Tipo, IdSesion, IdTurno, IdPaciente, AccionLog, TelefonoWhatsApp,
    PayloadJson, ResultadoLog, MensajeErrorLog, FechaRegistro
  )
  SELECT
    'LOG',
    ISNULL(l.IdConversacion, 'log-' + CAST(l.IdLog AS VARCHAR(20))),
    l.IdTurno, l.IdPaciente, l.Accion, l.TelefonoWhatsApp,
    l.PayloadJson, l.Resultado, l.MensajeError, l.FechaAccion
  FROM dbo.imBotTurnosLog l
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.imBotChat ch
    WHERE ch.Tipo = 'LOG'
      AND ch.IdSesion = ISNULL(l.IdConversacion, 'log-' + CAST(l.IdLog AS VARCHAR(20)))
      AND ch.AccionLog = l.Accion
      AND ch.FechaRegistro = l.FechaAccion
  );
END
GO

DECLARE @maxId INT = (SELECT ISNULL(MAX(IdRegistro), 0) FROM dbo.imBotChat);
IF @maxId > 0
  DBCC CHECKIDENT ('dbo.imBotChat', RESEED, @maxId);
GO

PRINT '=== [4/6] Eliminar tablas legacy ===';
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje')
  DROP TABLE dbo.imBotMensaje;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConversacion')
  DROP TABLE dbo.imBotConversacion;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotTurnosLog')
  DROP TABLE dbo.imBotTurnosLog;
GO

PRINT '=== [5/6] Resumen de tablas imBot* ===';
GO

SELECT TABLE_NAME AS Tabla
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME LIKE 'imBot%'
ORDER BY TABLE_NAME;
GO

PRINT '=== [6/6] Conteos imBotChat por Tipo ===';
GO

SELECT Tipo, COUNT(*) AS Filas
FROM dbo.imBotChat
GROUP BY Tipo
ORDER BY Tipo;
GO

PRINT 'deploy_bot_whatsapp_remoto.sql OK — esquema listo (imBotConfig + imBotChat, sin legacy).';
GO
