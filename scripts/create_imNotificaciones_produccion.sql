/*
  Tabla imNotificaciones (alineada con ACLYSA / iSource).
  Ejecutar en la base de datos de PRODUCCIÓN correspondiente (ajustar USE).

  Último paso: correr este script en el servidor de producción cuando
  las notificaciones de adjuntos estén validadas en local.
*/
-- USE [SuBaseDatos];
-- GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[imNotificaciones]') AND type IN (N'U'))
BEGIN
    CREATE TABLE [dbo].[imNotificaciones] (
        [IdNotificacion] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [ValorPersonal] INT NOT NULL,
        [TipoNotificacion] VARCHAR(50) NOT NULL,
        [DescNotificacion] VARCHAR(250) NOT NULL,
        [EntidadTipo] VARCHAR(50) NULL,
        [EntidadId] INT NULL,
        [DatosJSON] NVARCHAR(MAX) NULL,
        [Leida] BIT NOT NULL CONSTRAINT DF_imNotificaciones_Leida DEFAULT 0,
        [FechaCarga] DATETIME NOT NULL CONSTRAINT DF_imNotificaciones_FechaCarga DEFAULT GETDATE(),
        [MostrarHasta] DATETIME NULL,
        [Marca] VARCHAR(20) NULL
    );

    CREATE INDEX IX_imNotificaciones_ValorPersonal ON [dbo].[imNotificaciones]([ValorPersonal]);
    CREATE INDEX IX_imNotificaciones_Leida ON [dbo].[imNotificaciones]([Leida]);
    CREATE INDEX IX_imNotificaciones_FechaCarga ON [dbo].[imNotificaciones]([FechaCarga]);

    PRINT 'imNotificaciones creada.';
END
ELSE
    PRINT 'imNotificaciones ya existe.';
GO
