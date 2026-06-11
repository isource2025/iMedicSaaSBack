/* Elimina tablas legacy tras migración a imBotChat */
SET NOCOUNT ON;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje')
  DROP TABLE dbo.imBotMensaje;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConversacion')
  DROP TABLE dbo.imBotConversacion;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotTurnosLog')
  DROP TABLE dbo.imBotTurnosLog;

DECLARE @maxId INT = (SELECT ISNULL(MAX(IdRegistro), 0) FROM dbo.imBotChat);
IF @maxId > 0
  DBCC CHECKIDENT ('dbo.imBotChat', RESEED, @maxId);
GO
