-- Corrige TR_imTurnos_Insert: al archivar turnos cancelados (Status=1) en imTurnosLog
-- debe copiar IdTurno (columna NOT NULL en el log).
IF OBJECT_ID('dbo.TR_imTurnos_Insert', 'TR') IS NOT NULL
    DROP TRIGGER dbo.TR_imTurnos_Insert;
GO

CREATE TRIGGER [dbo].[TR_imTurnos_Insert]
ON [dbo].[imTurnos]
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.imTurnosLog (
        Dia, FechaAsignada, HoraAsignada, IDPaciente,
        Profesional, Sector, Horallegada, HoraIngreso,
        HoraSalida, Especialidad, Observaciones, FechaCarga,
        HoraCarga, CodOperador, Status, TipoTurno,
        NumeroVisita, NumeroDocumento, MotivoCancelacion,
        IdClasificacionTriage, IdTurno
    )
    SELECT
        t.Dia, t.FechaAsignada, t.HoraAsignada, t.IDPaciente,
        t.Profesional, t.Sector, t.Horallegada, t.HoraIngreso,
        t.HoraSalida, t.Especialidad, t.Observaciones, t.FechaCarga,
        t.HoraCarga, t.CodOperador, t.Status, t.TipoTurno,
        t.NumeroVisita, t.NumeroDocumento, t.MotivoCancelacion,
        t.IdClasificacionTriage, t.IdTurno
    FROM dbo.imTurnos t
    INNER JOIN inserted i
        ON  t.FechaAsignada = i.FechaAsignada
        AND t.HoraAsignada  = i.HoraAsignada
        AND t.Profesional   = i.Profesional
        AND t.Sector        = i.Sector
    WHERE t.Status = 1;

    DELETE t
    FROM dbo.imTurnos t
    INNER JOIN inserted i
        ON  t.FechaAsignada = i.FechaAsignada
        AND t.HoraAsignada  = i.HoraAsignada
        AND t.Profesional   = i.Profesional
        AND t.Sector        = i.Sector
    WHERE t.Status = 1;

    INSERT INTO dbo.imTurnos (
        Dia, FechaAsignada, HoraAsignada, IDPaciente,
        Profesional, Sector, Horallegada, HoraIngreso,
        HoraSalida, Especialidad, Observaciones, FechaCarga,
        HoraCarga, CodOperador, Status, TipoTurno,
        NumeroVisita, NumeroDocumento, MotivoCancelacion,
        IdClasificacionTriage
    )
    SELECT
        Dia, FechaAsignada, HoraAsignada, IDPaciente,
        Profesional, Sector, Horallegada, HoraIngreso,
        HoraSalida, Especialidad, Observaciones, FechaCarga,
        HoraCarga, CodOperador, Status, TipoTurno,
        NumeroVisita, NumeroDocumento, MotivoCancelacion,
        IdClasificacionTriage
    FROM inserted;
END;
GO
