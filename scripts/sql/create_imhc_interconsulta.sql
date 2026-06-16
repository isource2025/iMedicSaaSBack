-- Tabla interconsultas (idempotente)
IF OBJECT_ID(N'dbo.imHCInterconsulta', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imHCInterconsulta (
    IdInterconsulta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdVisita INT NOT NULL,
    FechaSolicitud INT NOT NULL,
    HoraSolicitud INT NULL,
    Especialidad VARCHAR(120) NULL,
    MedicoSolicitante INT NULL,
    Motivo VARCHAR(MAX) NOT NULL,
    Estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    Respuesta VARCHAR(MAX) NULL,
    FechaRespuesta INT NULL
  );
  CREATE INDEX IX_imHCInterconsulta_Visita ON dbo.imHCInterconsulta (IdVisita);
END
