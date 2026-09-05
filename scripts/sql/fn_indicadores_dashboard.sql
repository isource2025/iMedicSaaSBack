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
            LTRIM(RTRIM(ISNULL(vm.ValorSector, ''))) AS ValorSector,
            CAST(dbo.fn_ClarionDATE2SQL(vm.FechaAdmision) AS date) AS FechaAdmision,
            CASE
              WHEN vm.FechaEgreso IS NULL OR vm.FechaEgreso = 0 THEN NULL
              ELSE CAST(dbo.fn_ClarionDATE2SQL(vm.FechaEgreso) AS date)
            END AS FechaEgreso
        FROM dbo.imVisitaMovimiento vm
        WHERE vm.FechaAdmision IS NOT NULL AND vm.FechaAdmision > 0
    ),
    CamasPorSector AS (
        SELECT
          LTRIM(RTRIM(ISNULL(ValorSector, ''))) AS ValorSector,
          COUNT(*) AS TotalCamas
        FROM dbo.imHabitacionCamas
        WHERE UPPER(LTRIM(RTRIM(ISNULL(Tipo, '')))) = 'CAMA'
        GROUP BY LTRIM(RTRIM(ISNULL(ValorSector, '')))
    ),
    Meses AS (
        SELECT DATEFROMPARTS(YEAR(@FechaInicio), MONTH(@FechaInicio), 1) AS Mes
        UNION ALL
        SELECT DATEADD(MONTH, 1, Mes)
        FROM Meses
        WHERE Mes < DATEFROMPARTS(YEAR(@FechaFin), MONTH(@FechaFin), 1)
    ),
    Periodos AS (
        SELECT
            m.Mes,
            CASE WHEN m.Mes > @FechaInicio THEN m.Mes ELSE @FechaInicio END AS PeriodoInicio,
            CASE WHEN EOMONTH(m.Mes) < @FechaFin THEN EOMONTH(m.Mes) ELSE @FechaFin END AS PeriodoFin
        FROM Meses m
    ),
    PacientesMes AS (
        SELECT
            i.ValorSector,
            p.Mes,
            p.PeriodoInicio,
            p.PeriodoFin,
            SUM(
                CASE
                    WHEN
                        CASE WHEN i.FechaAdmision > p.PeriodoInicio THEN i.FechaAdmision ELSE p.PeriodoInicio END
                        <=
                        CASE WHEN i.FechaEgreso IS NULL OR i.FechaEgreso > p.PeriodoFin THEN p.PeriodoFin ELSE i.FechaEgreso END
                    THEN
                        DATEDIFF(
                            DAY,
                            CASE WHEN i.FechaAdmision > p.PeriodoInicio THEN i.FechaAdmision ELSE p.PeriodoInicio END,
                            DATEADD(
                                DAY, 1,
                                CASE WHEN i.FechaEgreso IS NULL OR i.FechaEgreso > p.PeriodoFin THEN p.PeriodoFin ELSE i.FechaEgreso END
                            )
                        )
                    ELSE 0
                END
            ) AS PacientesDia
        FROM Internados i
        CROSS JOIN Periodos p
        WHERE i.FechaAdmision <= p.PeriodoFin
          AND (i.FechaEgreso IS NULL OR i.FechaEgreso >= p.PeriodoInicio)
        GROUP BY i.ValorSector, p.Mes, p.PeriodoInicio, p.PeriodoFin
    )
    INSERT INTO @Resultados
    SELECT
        'Mensual' AS TipoIndicador,
        FORMAT(pm.Mes, 'yyyy-MM') AS Periodo,
        pm.ValorSector,
        pm.PacientesDia,
        c.TotalCamas,
        DATEDIFF(DAY, pm.PeriodoInicio, pm.PeriodoFin) + 1 AS DiasDelMes,
        CAST(
          pm.PacientesDia * 1.0
            / NULLIF(c.TotalCamas * (DATEDIFF(DAY, pm.PeriodoInicio, pm.PeriodoFin) + 1), 0)
            * 100 AS DECIMAL(10,2)
        ) AS OcupacionPromedioPct
    FROM PacientesMes pm
    JOIN CamasPorSector c ON pm.ValorSector = c.ValorSector
    WHERE pm.PacientesDia > 0
    OPTION (MAXRECURSION 120);

    RETURN;
END;
GO
