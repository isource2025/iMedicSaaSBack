-- Tablas de soporte para chatbot WhatsApp / integraciones
-- Ejecutar en la BD tenant (SQL Server) de cada institución.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotConfig' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotConfig (
    IdConfig          INT IDENTITY(1,1) PRIMARY KEY,
    Clave             VARCHAR(50)  NOT NULL,
    Valor             NVARCHAR(MAX) NULL,
    Tipo              VARCHAR(20)  NOT NULL DEFAULT 'string',
    Activo            BIT          NOT NULL DEFAULT 1,
    FechaModificacion DATETIME     NOT NULL DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_imBotConfig_Clave ON dbo.imBotConfig (Clave) WHERE Activo = 1;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'imBotTurnosLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.imBotTurnosLog (
    IdLog             INT IDENTITY(1,1) PRIMARY KEY,
    IdConversacion    VARCHAR(100) NULL,
    IdTurno           INT          NULL,
    IdPaciente        INT          NULL,
    Accion            VARCHAR(30)  NOT NULL,
    TelefonoWhatsApp  VARCHAR(20)  NULL,
    PayloadJson       NVARCHAR(MAX) NULL,
    Resultado         VARCHAR(20)  NOT NULL DEFAULT 'OK',
    MensajeError      VARCHAR(500) NULL,
    FechaAccion       DATETIME     NOT NULL DEFAULT GETDATE()
  );
  CREATE INDEX IX_imBotTurnosLog_Fecha ON dbo.imBotTurnosLog (FechaAccion DESC);
  CREATE INDEX IX_imBotTurnosLog_Paciente ON dbo.imBotTurnosLog (IdPaciente);
END
GO

-- Valores iniciales opcionales (sobreescriben env si existen)
IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'mensaje_bienvenida')
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES
    ('mensaje_bienvenida', 'Hola, soy el asistente de turnos. Para comenzar indicá tu DNI (sin puntos).', 'string'),
    ('requiere_renaper', 'true', 'bool'),
    ('crear_paciente_automatico', 'true', 'bool'),
    ('anticipacion_min_horas', '2', 'int'),
    ('dias_max_antelacion', '60', 'int'),
    ('max_turnos_por_paciente_dia', '1', 'int');
GO
