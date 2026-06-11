/*
  Setup mínimo Bot WhatsApp + turnera (SQL Server tenant)
  =======================================================
  Objetivo: 2 tablas nuevas de bot (no duplicar turnera):
    - imBotConfig   → configuración clave/valor
    - imBotChat     → sesiones WhatsApp + mensajes + log de turnos (columna Tipo)

  La turnera sigue en tablas clínicas existentes:
    imTurnos, imPersonalHorarios, imPersonalNoHorarios, imFeriados, imPacientes, imPersonal

  Si existen imBotConversacion / imBotMensaje / imBotTurnosLog (legacy), migra a imBotChat.
  Las tablas legacy NO se eliminan automáticamente (ver sección final opcional).

  Ejecutar en SSMS o: node scripts/ejecutar_setup_bot.js
*/

SET NOCOUNT ON;
GO

/* ── 1. imBotConfig ── */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConfig' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotConfig (
    IdConfig          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Clave             VARCHAR(50)       NOT NULL,
    Valor             NVARCHAR(MAX)     NULL,
    Tipo              VARCHAR(20)       NOT NULL DEFAULT 'string',
    Activo            BIT               NOT NULL DEFAULT 1,
    FechaModificacion DATETIME          NOT NULL DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_imBotConfig_Clave ON dbo.imBotConfig (Clave) WHERE Activo = 1;
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'mensaje_bienvenida')
BEGIN
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES
    ('mensaje_bienvenida', N'Hola, soy el asistente de turnos. Para comenzar indicá tu DNI (sin puntos).', 'string'),
    ('requiere_renaper', 'true', 'bool'),
    ('crear_paciente_automatico', 'true', 'bool'),
    ('anticipacion_min_horas', '2', 'int'),
    ('dias_max_antelacion', '60', 'int'),
    ('max_turnos_por_paciente_dia', '1', 'int');
END
GO

/* ── 2. imBotChat (sesión + mensaje + log en una tabla) ── */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotChat' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotChat (
    IdRegistro         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Tipo               VARCHAR(10)       NOT NULL,  /* SESION | MSG | LOG */
    IdSesion           VARCHAR(100)      NOT NULL,

    /* --- SESION (inbox / estado wizard) --- */
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

    /* --- MSG --- */
    Direccion          VARCHAR(10)       NULL,
    Origen             VARCHAR(20)       NULL,
    Contenido          NVARCHAR(MAX)     NULL,
    EstadoEntrega      VARCHAR(20)       NULL,
    MetaMessageId      VARCHAR(100)      NULL,

    /* --- LOG turnos bot --- */
    IdTurno            INT               NULL,
    AccionLog          VARCHAR(30)       NULL,
    PayloadJson        NVARCHAR(MAX)     NULL,
    ResultadoLog       VARCHAR(20)       NULL,
    MensajeErrorLog    VARCHAR(500)      NULL,

    FechaRegistro      DATETIME          NOT NULL CONSTRAINT DF_imBotChat_Fecha DEFAULT GETDATE(),

    CONSTRAINT CK_imBotChat_Tipo CHECK (Tipo IN ('SESION', 'MSG', 'LOG'))
  );

  CREATE UNIQUE INDEX UX_imBotChat_Sesion
    ON dbo.imBotChat (IdSesion) WHERE Tipo = 'SESION';

  CREATE INDEX IX_imBotChat_Sesion_Ultimo
    ON dbo.imBotChat (FechaUltimoMensaje DESC, FechaRegistro DESC)
    WHERE Tipo = 'SESION' AND SesionActiva = 1;

  CREATE INDEX IX_imBotChat_Telefono
    ON dbo.imBotChat (TelefonoWhatsApp) WHERE Tipo = 'SESION';

  CREATE INDEX IX_imBotChat_Msg_Sesion_Fecha
    ON dbo.imBotChat (IdSesion, FechaRegistro ASC, IdRegistro ASC)
    WHERE Tipo = 'MSG';

  CREATE INDEX IX_imBotChat_Log_Fecha
    ON dbo.imBotChat (FechaRegistro DESC) WHERE Tipo = 'LOG';

  CREATE INDEX IX_imBotChat_MetaId
    ON dbo.imBotChat (MetaMessageId) WHERE Tipo = 'MSG' AND MetaMessageId IS NOT NULL;
END
GO

/* ── 3. Migración desde legacy (solo si imBotChat vacío) ── */
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConversacion')
   AND NOT EXISTS (SELECT 1 FROM dbo.imBotChat WHERE Tipo = 'SESION')
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
  FROM dbo.imBotConversacion c;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje')
   AND NOT EXISTS (SELECT 1 FROM dbo.imBotChat WHERE Tipo = 'MSG')
BEGIN
  INSERT INTO dbo.imBotChat (
    Tipo, IdSesion, Direccion, Origen, Contenido, EstadoEntrega,
    IdAgente, NombreAgente, MetaMessageId, FechaRegistro
  )
  SELECT
    'MSG', m.IdConversacion, m.Direccion, m.Origen, m.Contenido, m.EstadoEntrega,
    m.IdAgente, m.NombreAgente, m.MetaMessageId, m.FechaMensaje
  FROM dbo.imBotMensaje m
  ORDER BY m.FechaMensaje ASC, m.IdMensaje ASC;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotTurnosLog')
   AND NOT EXISTS (SELECT 1 FROM dbo.imBotChat WHERE Tipo = 'LOG')
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
  FROM dbo.imBotTurnosLog l;
END
GO

/* Resincronizar IDENTITY de imBotChat por encima del máximo IdRegistro migrado */
DECLARE @maxId INT = (SELECT ISNULL(MAX(IdRegistro), 0) FROM dbo.imBotChat);
IF @maxId > 0
  DBCC CHECKIDENT ('dbo.imBotChat', RESEED, @maxId);
GO

PRINT 'setup_bot_minimal.sql OK — imBotConfig + imBotChat listos.';
GO

/*
  ── OPCIONAL: eliminar tablas legacy tras validar migración ──
  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje') DROP TABLE dbo.imBotMensaje;
  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConversacion') DROP TABLE dbo.imBotConversacion;
  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotTurnosLog') DROP TABLE dbo.imBotTurnosLog;
*/
