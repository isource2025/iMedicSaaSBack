/*
  Reset completo de imBotChat y migración limpia desde tablas legacy.
  Orden: SESION → MSG (conserva IdMensaje) → LOG (nuevos IdRegistro)
*/
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotChat')
BEGIN
  RAISERROR('imBotChat no existe. Ejecutá setup_bot_minimal.sql primero.', 16, 1);
  RETURN;
END

DELETE FROM dbo.imBotChat;
DBCC CHECKIDENT ('dbo.imBotChat', RESEED, 0);

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
  FROM dbo.imBotConversacion c;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje')
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

DECLARE @maxId INT = (SELECT ISNULL(MAX(IdRegistro), 0) FROM dbo.imBotChat);
IF @maxId > 0
  DBCC CHECKIDENT ('dbo.imBotChat', RESEED, @maxId);
GO

PRINT 'reset_and_migrate_imBotChat OK';
GO
