/* Completa migración legacy → imBotChat (idempotente) */
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotChat')
  RETURN;

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
  );
  SET IDENTITY_INSERT dbo.imBotChat OFF;
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
