/*
  LOCAL: crear tabla imNotificaciones para probar notificaciones de adjuntos.
  1) Ajustar USE a tu base de desarrollo.
  2) Ejecutar en SSMS o sqlcmd.
  3) Reiniciar el backend y subir un adjunto; listar con:
     GET /api/notificaciones?userId=<ValorPersonal>
*/
-- USE [TuBaseLocal];
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
        [Leida] BIT NOT NULL CONSTRAINT DF_imNotif_Local_Leida DEFAULT 0,
        [FechaCarga] DATETIME NOT NULL CONSTRAINT DF_imNotif_Local_Fecha DEFAULT GETDATE(),
        [MostrarHasta] DATETIME NULL,
        [Marca] VARCHAR(20) NULL
    );

    CREATE INDEX IX_imNotificaciones_ValorPersonal ON [dbo].[imNotificaciones]([ValorPersonal]);
    CREATE INDEX IX_imNotificaciones_Leida ON [dbo].[imNotificaciones]([Leida]);
    CREATE INDEX IX_imNotificaciones_FechaCarga ON [dbo].[imNotificaciones]([FechaCarga]);

    PRINT 'imNotificaciones creada (local).';
END
ELSE
    PRINT 'imNotificaciones ya existe.';
GO
