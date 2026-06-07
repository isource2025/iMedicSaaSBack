-- Conversaciones y mensajes del chatbot WhatsApp (inbox agente)
-- Ejecutar en la BD tenant (SQL Server) de cada institución.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConversacion' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotConversacion (
    IdConversacion      VARCHAR(100)  NOT NULL PRIMARY KEY,
    TelefonoWhatsApp    VARCHAR(20)   NOT NULL,
    NombreContacto      VARCHAR(120)  NULL,
    IdPaciente          INT           NULL,
    DniPaciente         VARCHAR(20)   NULL,
    ModoControl         VARCHAR(20)   NOT NULL DEFAULT 'BOT',
    PasoBot             VARCHAR(50)   NULL,
    IdAgente            INT           NULL,
    NombreAgente        VARCHAR(120)  NULL,
    NoLeidos            INT           NOT NULL DEFAULT 0,
    UltimoMensaje       NVARCHAR(500) NULL,
    FechaUltimoMensaje  DATETIME      NULL,
    FechaCreacion       DATETIME      NOT NULL DEFAULT GETDATE(),
    Activo              BIT           NOT NULL DEFAULT 1
  );
  CREATE INDEX IX_imBotConversacion_Ultimo ON dbo.imBotConversacion (FechaUltimoMensaje DESC);
  CREATE INDEX IX_imBotConversacion_Telefono ON dbo.imBotConversacion (TelefonoWhatsApp);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotMensaje' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotMensaje (
    IdMensaje           INT IDENTITY(1,1) PRIMARY KEY,
    IdConversacion      VARCHAR(100)  NOT NULL,
    Direccion           VARCHAR(10)   NOT NULL,
    Origen              VARCHAR(20)   NOT NULL,
    Contenido           NVARCHAR(MAX) NOT NULL,
    EstadoEntrega       VARCHAR(20)   NOT NULL DEFAULT 'ENVIADO',
    IdAgente            INT           NULL,
    NombreAgente        VARCHAR(120)  NULL,
    MetaMessageId       VARCHAR(100)  NULL,
    FechaMensaje        DATETIME      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_imBotMensaje_Conversacion
      FOREIGN KEY (IdConversacion) REFERENCES dbo.imBotConversacion(IdConversacion)
  );
  CREATE INDEX IX_imBotMensaje_Conv_Fecha ON dbo.imBotMensaje (IdConversacion, FechaMensaje ASC);
END
GO
