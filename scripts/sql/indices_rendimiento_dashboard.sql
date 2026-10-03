/*
  Índices de rendimiento para el panel de inicio y la analítica de camas.
  (indicadores.service.js, visitaMovimientos.service.js → obtenerMovimientosRecientes,
   beds.service.js → listado de camas por sector)

  Ejecutar UNA VEZ en cada BD tenant SQL Server. Es idempotente (IF NOT EXISTS).
  Revisá con el DBA de la clínica antes de aplicarlo en producción: son índices
  no agrupados sobre tablas Clarion; no modifican datos ni esquemas de columnas.

  Qué acelera cada uno:
    IX_imVisitaMovimiento_FechaAdmision   → "últimos ingresos / movimientos" (TOP 10 ORDER BY FechaAdmision DESC)
                                            y el CTE Internados (WHERE FechaAdmision > 0).
    IX_imVisitaMovimiento_FechaEgreso     → "últimos egresos" (TOP 10 ORDER BY FechaEgreso DESC).
    IX_imVisitaMovimiento_NumeroVisita    → joins con imVisita / detalle de una visita.
    IX_imVisita_FechaAdmisionS_Clase      → fn_GetIndicadores / ingresos por fecha y clase.
    IX_imHabitacionCamas_Sector           → listado de camas por sector y conteo por sector.
*/

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imVisitaMovimiento_FechaAdmision'
                 AND object_id = OBJECT_ID('dbo.imVisitaMovimiento'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_imVisitaMovimiento_FechaAdmision
    ON dbo.imVisitaMovimiento (FechaAdmision DESC, HoraAdmision DESC)
    INCLUDE (NumeroVisita, FechaEgreso, HoraEgreso, ValorHabitacionCama, ValorSector, EstadoCama);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imVisitaMovimiento_FechaEgreso'
                 AND object_id = OBJECT_ID('dbo.imVisitaMovimiento'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_imVisitaMovimiento_FechaEgreso
    ON dbo.imVisitaMovimiento (FechaEgreso DESC, HoraEgreso DESC)
    INCLUDE (NumeroVisita, FechaAdmision, HoraAdmision, ValorHabitacionCama, ValorSector, EstadoCama);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imVisitaMovimiento_NumeroVisita'
                 AND object_id = OBJECT_ID('dbo.imVisitaMovimiento'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_imVisitaMovimiento_NumeroVisita
    ON dbo.imVisitaMovimiento (NumeroVisita)
    INCLUDE (FechaAdmision, HoraAdmision, FechaEgreso, HoraEgreso, ValorSector, ValorHabitacionCama);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imVisita_FechaAdmisionS_Clase'
                 AND object_id = OBJECT_ID('dbo.imVisita'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_imVisita_FechaAdmisionS_Clase
    ON dbo.imVisita (FechaAdmisionS, ClasePaciente)
    INCLUDE (NumeroVisita, IDPaciente);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_imHabitacionCamas_Sector'
                 AND object_id = OBJECT_ID('dbo.imHabitacionCamas'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_imHabitacionCamas_Sector
    ON dbo.imHabitacionCamas (ValorSector)
    INCLUDE (ValorHabitacionCama, NumeroVisita);
END
GO
