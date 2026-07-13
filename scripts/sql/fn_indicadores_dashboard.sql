/*
  Indicadores de dashboard — requeridos por iMedic SaaS
  (indicadores.service.js → fn_GetIndicadores, fn_OcupacionPromedioCamas)

  Ejecutar UNA VEZ en cada BD tenant SQL Server (ej. producción SERVER-1\SQLEXPRESS).

  Dependencia de ocupación: dbo.fn_ClarionDATE2SQL (se crea abajo si falta).
*/

IF OBJECT_ID('dbo.fn_ClarionDATE2SQL', 'FN') IS NULL
BEGIN
  EXEC('
  CREATE FUNCTION [dbo].[fn_ClarionDATE2SQL] (@ClarionDate int)
  RETURNS DATETIME
  AS
  BEGIN
    DECLARE @SqlDateTime DATETIME
    SET @SqlDateTime = DateAdd(day, @ClarionDate - 4, ''1801-01-01'')
    RETURN @SqlDateTime
  END
  ');
END
GO

IF OBJECT_ID('dbo.fn_GetIndicadores', 'TF') IS NOT NULL
  DROP FUNCTION dbo.fn_GetIndicadores;
GO

CREATE FUNCTION [dbo].[fn_GetIndicadores]
(
    @TipoIndicador VARCHAR(50),
    @FechaInicio DATE = NULL,
    @FechaFin DATE = NULL
)
RETURNS @Resultados TABLE
(
    Fecha DATE,
    ClasePaciente VARCHAR(100),
    TotalIngresos INT
)
AS
BEGIN
    DECLARE @FechaFinInclusive DATETIME = DATEADD(DAY, 1, @FechaFin);

    IF @TipoIndicador = 'Ingresos'
    BEGIN
        INSERT INTO @Resultados
        SELECT
            CAST(v.FechaAdmisionS AS DATE) AS Fecha,
            cp.Descripcion AS ClasePaciente,
            COUNT(*) AS TotalIngresos
        FROM dbo.imVisita v
        INNER JOIN dbo.imClasePaciente cp
            ON v.ClasePaciente = cp.Valor
        WHERE (@FechaInicio IS NULL OR v.FechaAdmisionS >= @FechaInicio)
          AND (@FechaFin IS NULL OR v.FechaAdmisionS < @FechaFinInclusive)
        GROUP BY CAST(v.FechaAdmisionS AS DATE), cp.Descripcion;
    END
    ELSE IF @TipoIndicador = 'TotalesPorClase'
    BEGIN
        INSERT INTO @Resultados
        SELECT
            NULL AS Fecha,
            cp.Descripcion AS ClasePaciente,
            COUNT(*) AS TotalIngresos
        FROM dbo.imVisita v
        INNER JOIN dbo.imClasePaciente cp
            ON v.ClasePaciente = cp.Valor
        WHERE (@FechaInicio IS NULL OR v.FechaAdmisionS >= @FechaInicio)
          AND (@FechaFin IS NULL OR v.FechaAdmisionS < @FechaFinInclusive)
        GROUP BY cp.Descripcion;
    END
    ELSE IF @TipoIndicador = 'TotalesGenerales'
    BEGIN
        INSERT INTO @Resultados
        SELECT
            NULL AS Fecha,
            'TOTAL' AS ClasePaciente,
            COUNT(*) AS TotalIngresos
        FROM dbo.imVisita v
        WHERE (@FechaInicio IS NULL OR v.FechaAdmisionS >= @FechaInicio)
          AND (@FechaFin IS NULL OR v.FechaAdmisionS < @FechaFinInclusive);
    END

    RETURN;
END;
GO

IF OBJECT_ID('dbo.fn_OcupacionPromedioCamas', 'TF') IS NOT NULL
  DROP FUNCTION dbo.fn_OcupacionPromedioCamas;
GO

CREATE FUNCTION [dbo].[fn_OcupacionPromedioCamas]
(
    @FechaInicio DATE,
    @FechaFin DATE
)
RETURNS @Resultados TABLE
(
    TipoIndicador VARCHAR(50),
    Periodo VARCHAR(7),
    ValorSector VARCHAR(50),
    PacientesDia INT,
    TotalCamas INT,
    DiasDelMes INT,
    OcupacionPromedioPct DECIMAL(10,2)
)
AS
BEGIN
    ;WITH Internados AS (
        SELECT
            vm.NumeroVisita,
            vm.ValorSector,
            CAST(dbo.fn_ClarionDATE2SQL(vm.FechaAdmision) AS date) AS FechaAdmision,
            CAST(dbo.fn_ClarionDATE2SQL(vm.FechaEgreso) AS date)   AS FechaEgreso
        FROM dbo.imVisitaMovimiento vm
    ),
    CamasPorSector AS (
        SELECT ValorSector, COUNT(*) AS TotalCamas
        FROM dbo.imHabitacionCamas
        GROUP BY ValorSector
    ),
    Meses AS (
        SELECT DATEFROMPARTS(YEAR(@FechaInicio), MONTH(@FechaInicio), 1) AS Mes
        UNION ALL
        SELECT DATEADD(MONTH, 1, Mes)
        FROM Meses
        WHERE Mes < DATEFROMPARTS(YEAR(@FechaFin), MONTH(@FechaFin), 1)
    ),
    PacientesMes AS (
        SELECT
            i.ValorSector,
            m.Mes,
            SUM(
                DATEDIFF(
                    DAY,
                    CASE WHEN i.FechaAdmision < m.Mes THEN m.Mes ELSE i.FechaAdmision END,
                    DATEADD(DAY,1,
                        CASE
                            WHEN i.FechaEgreso IS NULL OR i.FechaEgreso > EOMONTH(m.Mes)
                            THEN EOMONTH(m.Mes)
                            ELSE i.FechaEgreso
                        END
                    )
                )
            ) AS PacientesDia
        FROM Internados i
        CROSS JOIN Meses m
        WHERE i.FechaAdmision <= @FechaFin
          AND (i.FechaEgreso IS NULL OR i.FechaEgreso >= @FechaInicio)
          AND i.FechaAdmision <= EOMONTH(m.Mes)
          AND (i.FechaEgreso IS NULL OR i.FechaEgreso >= m.Mes)
        GROUP BY i.ValorSector, m.Mes
    )
    INSERT INTO @Resultados
    SELECT
        'Mensual' AS TipoIndicador,
        FORMAT(pm.Mes, 'yyyy-MM') AS Periodo,
        pm.ValorSector,
        pm.PacientesDia,
        c.TotalCamas,
        DAY(EOMONTH(pm.Mes)) AS DiasDelMes,
        CAST(pm.PacientesDia * 1.0 / NULLIF(c.TotalCamas * DAY(EOMONTH(pm.Mes)), 0) * 100 AS DECIMAL(10,2)) AS OcupacionPromedioPct
    FROM PacientesMes pm
    JOIN CamasPorSector c ON pm.ValorSector = c.ValorSector;

    RETURN;
END;
GO
