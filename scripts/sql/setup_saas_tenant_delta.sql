/*
================================================================================
  iMedic SaaS — DELTA completo para BD TENANT (SQL Server)
================================================================================
  Ejecutar en la base clínica del establecimiento (ej. producción SERVER-1\SQLEXPRESS).

  Idempotente: se puede correr varias veces sin romper datos.

  Incluye:
    1) Turnero          → imTurneroPantalla, imTurneroLlamado
    2) Notificaciones   → imNotificaciones
    3) HC interconsulta → imHCInterconsulta
    4) Bot WhatsApp     → imBotConfig, imBotChat (+ migración legacy si aplica)
    5) Laboratorios HC  → imHCExamenesLabCabecera/Detalle/DetalleConf
    6) Columnas agenda  → imTurnos.OperadorLlegada / OperadorIngreso
    7) Adjuntos turno   → imPedidosEstudiosAdjuntos.IdTurno
    8) Afiliación OS    → imClientes.NroAfiliadoDocumento / APIValidacionPaciente
    9) Indicadores      → fn_ClarionDATE2SQL, fn_GetIndicadores, fn_OcupacionPromedioCamas
   10) Vistas pedidos   → vw_iMedic_PedidosEstudios* (si existen tablas base)

  NO incluye (van en MySQL auth central / Railway):
    - AuthSessions, AuthAuditLog, AuthPaisesPermitidos, imTurneroTokens
    → usar scripts/sql/setup_saas_mysql_delta.sql
      o: node scripts/apply_security_mysql.js

  Uso SSMS:
    1. Conectá al SQL remoto
    2. USE [NombreDeTuBD];
    3. Ejecutá este archivo completo (F5)

  Uso Node (con .env apuntando a esa BD):
    node scripts/ejecutar_setup_saas_tenant.js
================================================================================
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

PRINT '=== iMedic SaaS tenant delta — inicio ===';
PRINT 'BD actual: ' + DB_NAME();
GO

/*------------------------------------------------------------------------------
  1) TURNERO
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imTurneroPantalla', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imTurneroPantalla (
    IdPantalla        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Nombre            NVARCHAR(100)     NOT NULL CONSTRAINT DF_imTurneroPantalla_Nombre DEFAULT N'Pantalla general',
    PublicToken       VARCHAR(64)       NOT NULL,
    ConfigJson        NVARCHAR(MAX)     NOT NULL,
    Activa            BIT               NOT NULL CONSTRAINT DF_imTurneroPantalla_Activa DEFAULT 1,
    FechaCreacion     DATETIME2         NOT NULL CONSTRAINT DF_imTurneroPantalla_Creacion DEFAULT SYSUTCDATETIME(),
    FechaModificacion DATETIME2         NOT NULL CONSTRAINT DF_imTurneroPantalla_Mod DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX UX_imTurneroPantalla_Token ON dbo.imTurneroPantalla (PublicToken);
  PRINT 'Creada: dbo.imTurneroPantalla';
END
ELSE
  PRINT 'OK: dbo.imTurneroPantalla ya existe';
GO

IF OBJECT_ID(N'dbo.imTurneroLlamado', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imTurneroLlamado (
    IdLlamado         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdTurno           INT               NOT NULL,
    IdPantalla        INT               NULL,
    Paciente          NVARCHAR(200)     NULL,
    Consultorio       NVARCHAR(50)      NULL,
    Profesional       NVARCHAR(200)     NULL,
    Sector            NVARCHAR(10)      NULL,
    HoraTurno         VARCHAR(8)        NULL,
    LlamadoEn         DATETIME2         NOT NULL CONSTRAINT DF_imTurneroLlamado_Fecha DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_imTurneroLlamado_Fecha ON dbo.imTurneroLlamado (LlamadoEn DESC);
  CREATE INDEX IX_imTurneroLlamado_Turno ON dbo.imTurneroLlamado (IdTurno);
  PRINT 'Creada: dbo.imTurneroLlamado';
END
ELSE
  PRINT 'OK: dbo.imTurneroLlamado ya existe';
GO

/*------------------------------------------------------------------------------
  2) NOTIFICACIONES
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imNotificaciones', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imNotificaciones (
    IdNotificacion   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ValorPersonal    INT NOT NULL,
    TipoNotificacion VARCHAR(50) NOT NULL,
    DescNotificacion VARCHAR(250) NOT NULL,
    EntidadTipo      VARCHAR(50) NULL,
    EntidadId       INT NULL,
    DatosJSON        NVARCHAR(MAX) NULL,
    Leida            BIT NOT NULL CONSTRAINT DF_imNotificaciones_Leida DEFAULT 0,
    FechaCarga       DATETIME NOT NULL CONSTRAINT DF_imNotificaciones_FechaCarga DEFAULT GETDATE(),
    MostrarHasta     DATETIME NULL,
    Marca            VARCHAR(20) NULL
  );
  CREATE INDEX IX_imNotificaciones_ValorPersonal ON dbo.imNotificaciones (ValorPersonal);
  CREATE INDEX IX_imNotificaciones_Leida ON dbo.imNotificaciones (Leida);
  CREATE INDEX IX_imNotificaciones_FechaCarga ON dbo.imNotificaciones (FechaCarga);
  PRINT 'Creada: dbo.imNotificaciones';
END
ELSE
  PRINT 'OK: dbo.imNotificaciones ya existe';
GO

/*------------------------------------------------------------------------------
  3) HC INTERCONSULTA
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imHCInterconsulta', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imHCInterconsulta (
    IdInterconsulta   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdVisita          INT NOT NULL,
    FechaSolicitud    INT NOT NULL,
    HoraSolicitud     INT NULL,
    Especialidad      VARCHAR(120) NULL,
    MedicoSolicitante INT NULL,
    Motivo            VARCHAR(MAX) NOT NULL,
    Estado            VARCHAR(20) NOT NULL CONSTRAINT DF_imHCInterconsulta_Estado DEFAULT 'PENDIENTE',
    Respuesta         VARCHAR(MAX) NULL,
    FechaRespuesta    INT NULL
  );
  CREATE INDEX IX_imHCInterconsulta_Visita ON dbo.imHCInterconsulta (IdVisita);
  PRINT 'Creada: dbo.imHCInterconsulta';
END
ELSE
  PRINT 'OK: dbo.imHCInterconsulta ya existe';
GO

/*------------------------------------------------------------------------------
  4) BOT WHATSAPP
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imBotConfig', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imBotConfig (
    IdConfig          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Clave             VARCHAR(50)       NOT NULL,
    Valor             NVARCHAR(MAX)     NULL,
    Tipo              VARCHAR(20)       NOT NULL CONSTRAINT DF_imBotConfig_Tipo DEFAULT 'string',
    Activo            BIT               NOT NULL CONSTRAINT DF_imBotConfig_Activo DEFAULT 1,
    FechaModificacion DATETIME          NOT NULL CONSTRAINT DF_imBotConfig_Mod DEFAULT GETDATE()
  );
  CREATE UNIQUE INDEX UX_imBotConfig_Clave ON dbo.imBotConfig (Clave) WHERE Activo = 1;
  PRINT 'Creada: dbo.imBotConfig';
END
ELSE
  PRINT 'OK: dbo.imBotConfig ya existe';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'mensaje_bienvenida')
BEGIN
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES
    (N'mensaje_bienvenida', N'Hola, soy el asistente de turnos. Para comenzar indicá tu DNI (sin puntos).', 'string'),
    (N'requiere_renaper', N'true', 'bool'),
    (N'crear_paciente_automatico', N'true', 'bool'),
    (N'anticipacion_min_horas', N'2', 'int'),
    (N'dias_max_antelacion', N'60', 'int'),
    (N'max_turnos_por_paciente_dia', N'1', 'int');
  PRINT 'Seed: imBotConfig defaults';
END
GO

IF OBJECT_ID(N'dbo.imBotChat', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imBotChat (
    IdRegistro         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Tipo               VARCHAR(10)       NOT NULL,
    IdSesion           VARCHAR(100)      NOT NULL,
    TelefonoWhatsApp   VARCHAR(20)       NULL,
    NombreContacto     VARCHAR(120)      NULL,
    IdPaciente         INT               NULL,
    DniPaciente        VARCHAR(20)       NULL,
    ModoControl        VARCHAR(20)       NULL CONSTRAINT DF_imBotChat_Modo DEFAULT 'BOT',
    PasoBot            VARCHAR(50)       NULL,
    ContextoBotJson    NVARCHAR(MAX)     NULL,
    IdAgente           INT               NULL,
    NombreAgente       VARCHAR(120)      NULL,
    NoLeidos           INT               NULL CONSTRAINT DF_imBotChat_NoLeidos DEFAULT 0,
    UltimoMensaje      NVARCHAR(500)     NULL,
    FechaUltimoMensaje DATETIME          NULL,
    SesionActiva       BIT               NULL CONSTRAINT DF_imBotChat_Activa DEFAULT 1,
    Direccion          VARCHAR(10)       NULL,
    Origen             VARCHAR(20)       NULL,
    Contenido          NVARCHAR(MAX)     NULL,
    EstadoEntrega      VARCHAR(20)       NULL,
    MetaMessageId      VARCHAR(100)      NULL,
    IdTurno            INT               NULL,
    AccionLog          VARCHAR(30)       NULL,
    PayloadJson        NVARCHAR(MAX)     NULL,
    ResultadoLog       VARCHAR(20)       NULL,
    MensajeErrorLog    VARCHAR(500)      NULL,
    FechaRegistro      DATETIME          NOT NULL CONSTRAINT DF_imBotChat_Fecha DEFAULT GETDATE(),
    CONSTRAINT CK_imBotChat_Tipo CHECK (Tipo IN ('SESION', 'MSG', 'LOG'))
  );
  CREATE UNIQUE INDEX UX_imBotChat_Sesion ON dbo.imBotChat (IdSesion) WHERE Tipo = 'SESION';
  CREATE INDEX IX_imBotChat_Sesion_Ultimo ON dbo.imBotChat (FechaUltimoMensaje DESC, FechaRegistro DESC)
    WHERE Tipo = 'SESION' AND SesionActiva = 1;
  CREATE INDEX IX_imBotChat_Telefono ON dbo.imBotChat (TelefonoWhatsApp) WHERE Tipo = 'SESION';
  CREATE INDEX IX_imBotChat_Msg_Sesion_Fecha ON dbo.imBotChat (IdSesion, FechaRegistro ASC, IdRegistro ASC)
    WHERE Tipo = 'MSG';
  CREATE INDEX IX_imBotChat_Log_Fecha ON dbo.imBotChat (FechaRegistro DESC) WHERE Tipo = 'LOG';
  PRINT 'Creada: dbo.imBotChat';
END
ELSE
  PRINT 'OK: dbo.imBotChat ya existe';
GO

IF OBJECT_ID(N'dbo.imBotConversacion', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.imBotChat', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.imBotChat WHERE Tipo = 'SESION')
BEGIN
  INSERT INTO dbo.imBotChat (
    Tipo, IdSesion, TelefonoWhatsApp, NombreContacto, IdPaciente, DniPaciente,
    ModoControl, PasoBot, ContextoBotJson, IdAgente, NombreAgente, NoLeidos,
    UltimoMensaje, FechaUltimoMensaje, SesionActiva, FechaRegistro
  )
  SELECT
    'SESION', c.IdConversacion, c.TelefonoWhatsApp, c.NombreContacto, c.IdPaciente, c.DniPaciente,
    c.ModoControl, c.PasoBot, c.ContextoBotJson, c.IdAgente, c.NombreAgente, c.NoLeidos,
    c.UltimoMensaje, c.FechaUltimoMensaje, c.Activo, ISNULL(c.FechaCreacion, GETDATE())
  FROM dbo.imBotConversacion c;
  PRINT 'Migrados SESION desde imBotConversacion';
END
GO

IF OBJECT_ID(N'dbo.imBotMensaje', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.imBotChat', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.imBotChat WHERE Tipo = 'MSG')
BEGIN
  INSERT INTO dbo.imBotChat (
    Tipo, IdSesion, Direccion, Origen, Contenido, EstadoEntrega,
    IdAgente, NombreAgente, MetaMessageId, FechaRegistro
  )
  SELECT
    'MSG', m.IdConversacion, m.Direccion, m.Origen, m.Contenido, m.EstadoEntrega,
    m.IdAgente, m.NombreAgente, m.MetaMessageId, m.FechaMensaje
  FROM dbo.imBotMensaje m
  ORDER BY m.FechaMensaje ASC, m.IdMensaje ASC;
  PRINT 'Migrados MSG desde imBotMensaje';
END
GO

IF OBJECT_ID(N'dbo.imBotTurnosLog', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.imBotChat', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.imBotChat WHERE Tipo = 'LOG')
BEGIN
  INSERT INTO dbo.imBotChat (
    Tipo, IdSesion, IdTurno, IdPaciente, AccionLog, TelefonoWhatsApp,
    PayloadJson, ResultadoLog, MensajeErrorLog, FechaRegistro
  )
  SELECT
    'LOG',
    ISNULL(l.IdConversacion, 'log-' + CAST(l.IdLog AS VARCHAR(20))),
    l.IdTurno, l.IdPaciente, l.Accion, l.TelefonoWhatsApp,
    l.PayloadJson, l.Resultado, l.MensajeError, l.FechaAccion
  FROM dbo.imBotTurnosLog l;
  PRINT 'Migrados LOG desde imBotTurnosLog';
END
GO

/*------------------------------------------------------------------------------
  5) LABORATORIOS HC
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imHCExamenesLabCabecera', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imHCExamenesLabCabecera (
    IdExamen INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NumeroVisita INT NOT NULL,
    FechaExamen DATE NOT NULL,
    HoraExamen VARCHAR(5) NULL,
    TipoEstudio VARCHAR(50) NOT NULL,
    Laboratorio VARCHAR(100) NULL,
    Protocolo VARCHAR(50) NULL,
    Observaciones VARCHAR(500) NULL,
    ArchivoAdjunto VARCHAR(255) NULL,
    FechaCarga DATETIME NULL CONSTRAINT DF_LabCab_Fecha DEFAULT GETDATE(),
    UsuarioCarga VARCHAR(50) NULL,
    Estado VARCHAR(20) NULL CONSTRAINT DF_LabCab_Estado DEFAULT 'PENDIENTE'
  );
  CREATE INDEX IX_imHCExamenesLabCabecera_NumeroVisita ON dbo.imHCExamenesLabCabecera (NumeroVisita);
  PRINT 'Creada: dbo.imHCExamenesLabCabecera';
END
ELSE
  PRINT 'OK: dbo.imHCExamenesLabCabecera ya existe';
GO

IF OBJECT_ID(N'dbo.imHCExamenesLabDetalle', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imHCExamenesLabDetalle (
    IdDetalle INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdExamen INT NOT NULL,
    CodigoParametro VARCHAR(20) NULL,
    NombreParametro VARCHAR(100) NOT NULL,
    Resultado VARCHAR(50) NOT NULL,
    UnidadMedida VARCHAR(20) NULL,
    ValorReferencia VARCHAR(100) NULL,
    ValorMinimo DECIMAL(10,2) NULL,
    ValorMaximo DECIMAL(10,2) NULL,
    FueraDeRango BIT NOT NULL CONSTRAINT DF_LabDet_Fuera DEFAULT 0,
    Metodo VARCHAR(100) NULL,
    MarcaReactivo VARCHAR(100) NULL,
    Orden INT NULL,
    CONSTRAINT FK_imHCExamenesLabDetalle_Cabecera FOREIGN KEY (IdExamen)
      REFERENCES dbo.imHCExamenesLabCabecera (IdExamen)
      ON DELETE CASCADE
  );
  CREATE INDEX IX_imHCExamenesLabDetalle_IdExamen ON dbo.imHCExamenesLabDetalle (IdExamen);
  PRINT 'Creada: dbo.imHCExamenesLabDetalle';
END
ELSE
  PRINT 'OK: dbo.imHCExamenesLabDetalle ya existe';
GO

IF OBJECT_ID(N'dbo.imHCExamenesLabDetalleConf', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.imHCExamenesLabDetalleConf (
    IdParametro INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CodigoParametro VARCHAR(20) NOT NULL,
    NombreParametro VARCHAR(100) NOT NULL,
    Categoria VARCHAR(50) NOT NULL,
    UnidadMedida VARCHAR(20) NULL,
    ValorMinimoAdulto DECIMAL(10,2) NULL,
    ValorMaximoAdulto DECIMAL(10,2) NULL,
    ValorMinimoNino DECIMAL(10,2) NULL,
    ValorMaximoNino DECIMAL(10,2) NULL,
    ValorMinimoHombre DECIMAL(10,2) NULL,
    ValorMaximoHombre DECIMAL(10,2) NULL,
    ValorMinimoMujer DECIMAL(10,2) NULL,
    ValorMaximoMujer DECIMAL(10,2) NULL,
    Activo BIT NOT NULL CONSTRAINT DF_LabConf_Activo DEFAULT 1,
    Sinonimos VARCHAR(500) NULL,
    AlertaCritica BIT NOT NULL CONSTRAINT DF_LabConf_Alerta DEFAULT 0,
    CONSTRAINT UQ_imHCExamenesLabDetalleConf_Codigo UNIQUE (CodigoParametro)
  );
  CREATE INDEX IX_imHCExamenesLabDetalleConf_Codigo ON dbo.imHCExamenesLabDetalleConf (CodigoParametro);
  CREATE INDEX IX_imHCExamenesLabDetalleConf_Categoria ON dbo.imHCExamenesLabDetalleConf (Categoria);
  PRINT 'Creada: dbo.imHCExamenesLabDetalleConf';
END
ELSE
  PRINT 'OK: dbo.imHCExamenesLabDetalleConf ya existe';
GO

/*------------------------------------------------------------------------------
  6) COLUMNAS AGENDA (trazabilidad operadores)
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imTurnos', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.imTurnos', 'OperadorLlegada') IS NULL
  BEGIN
    ALTER TABLE dbo.imTurnos ADD OperadorLlegada INT NULL;
    PRINT 'Columna: imTurnos.OperadorLlegada';
  END
  IF COL_LENGTH('dbo.imTurnos', 'OperadorIngreso') IS NULL
  BEGIN
    ALTER TABLE dbo.imTurnos ADD OperadorIngreso INT NULL;
    PRINT 'Columna: imTurnos.OperadorIngreso';
  END
END
ELSE
  PRINT 'AVISO: dbo.imTurnos no existe — omitido OperadorLlegada/Ingreso';
GO

/*------------------------------------------------------------------------------
  7) ADJUNTOS POR TURNO
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imPedidosEstudiosAdjuntos', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.imPedidosEstudiosAdjuntos', 'IdTurno') IS NULL
  BEGIN
    ALTER TABLE dbo.imPedidosEstudiosAdjuntos ADD IdTurno INT NULL;
    PRINT 'Columna: imPedidosEstudiosAdjuntos.IdTurno';
  END
END
ELSE
  PRINT 'AVISO: dbo.imPedidosEstudiosAdjuntos no existe — omitido IdTurno';
GO

/*------------------------------------------------------------------------------
  8) AFILIACIÓN / VALIDACIÓN OS (imClientes)
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imClientes', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.imClientes', 'NroAfiliadoDocumento') IS NULL
  BEGIN
    ALTER TABLE dbo.imClientes ADD NroAfiliadoDocumento BIT NULL;
    PRINT 'Columna: imClientes.NroAfiliadoDocumento';
  END
  IF COL_LENGTH('dbo.imClientes', 'APIValidacionPaciente') IS NULL
  BEGIN
    ALTER TABLE dbo.imClientes ADD APIValidacionPaciente VARCHAR(80) NULL;
    PRINT 'Columna: imClientes.APIValidacionPaciente';
  END
END
ELSE
  PRINT 'AVISO: dbo.imClientes no existe — omitidas columnas afiliación';
GO

/*------------------------------------------------------------------------------
  9) FUNCIONES INDICADORES DASHBOARD
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.fn_ClarionDATE2SQL', N'FN') IS NULL
BEGIN
  EXEC(N'
  CREATE FUNCTION dbo.fn_ClarionDATE2SQL (@ClarionDate int)
  RETURNS DATETIME
  AS
  BEGIN
    DECLARE @SqlDateTime DATETIME
    SET @SqlDateTime = DATEADD(day, @ClarionDate - 4, ''1801-01-01'')
    RETURN @SqlDateTime
  END
  ');
  PRINT 'Creada: dbo.fn_ClarionDATE2SQL';
END
ELSE
  PRINT 'OK: dbo.fn_ClarionDATE2SQL ya existe';
GO

IF OBJECT_ID(N'dbo.fn_GetIndicadores', N'TF') IS NOT NULL
  DROP FUNCTION dbo.fn_GetIndicadores;
GO

CREATE FUNCTION dbo.fn_GetIndicadores
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
        INNER JOIN dbo.imClasePaciente cp ON v.ClasePaciente = cp.Valor
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
        INNER JOIN dbo.imClasePaciente cp ON v.ClasePaciente = cp.Valor
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
PRINT 'Creada/actualizada: dbo.fn_GetIndicadores';
GO

IF OBJECT_ID(N'dbo.fn_OcupacionPromedioCamas', N'TF') IS NOT NULL
  DROP FUNCTION dbo.fn_OcupacionPromedioCamas;
GO

CREATE FUNCTION dbo.fn_OcupacionPromedioCamas
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
                    DATEADD(DAY, 1,
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
PRINT 'Creada/actualizada: dbo.fn_OcupacionPromedioCamas';
GO

/*------------------------------------------------------------------------------
  10) VISTAS PEDIDOS / INTERCONSULTAS (si existen tablas base)
------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dbo.imPedidosEstudios', N'U') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'dbo.vw_iMedic_PedidosEstudiosBase', N'V') IS NOT NULL
    DROP VIEW dbo.vw_iMedic_PedidosEstudiosBase;
END
GO

IF OBJECT_ID(N'dbo.imPedidosEstudios', N'U') IS NOT NULL
BEGIN
  EXEC(N'
  CREATE VIEW dbo.vw_iMedic_PedidosEstudiosBase AS
  SELECT
    pe.IdPedido,
    pe.IdVisita,
    pe.FechaPedido,
    CONVERT(varchar(10), pe.FechaPedido, 23) AS FechaPedidoISO,
    CONVERT(varchar(5), pe.FechaPedido, 108) AS HoraPedido,
    pe.IdTipoPedido,
    LTRIM(RTRIM(ISNULL(tp.DescPractica, ''''))) AS TipoPedidoDescripcion,
    pe.IdPractica AS CodigoPractica,
    LTRIM(RTRIM(ISNULL(tp.DescPractica, ''''))) AS PracticaSolicitada,
    LTRIM(RTRIM(ISNULL(nom.Descripcion, ''''))) AS NomencladorDescripcion,
    pe.NotasObservacion,
    pe.ValorProfesional AS MatriculaSolicitante,
    per.ApellidoNombre AS MedicoSolicitanteNombre,
    pe.IdProtocolo,
    pe.EstadoUrgencia,
    LTRIM(RTRIM(ISNULL(pe.IdSectorSolicitante, ''''))) AS SectorSolicitante,
    secSol.Descripcion AS SectorSolicitanteNombre,
    LTRIM(RTRIM(ISNULL(pe.IdSectorReceptor, ''''))) AS SectorReceptor,
    secRec.Descripcion AS SectorReceptorNombre,
    LTRIM(RTRIM(ISNULL(srv.Valor, ''''))) AS ServicioCodigo,
    srv.Descripcion AS ServicioDescripcion,
    CASE WHEN pe.IdTipoPedido = 33 THEN ''INTERCONSULTA'' ELSE ''ESTUDIO'' END AS CategoriaPedido
  FROM dbo.imPedidosEstudios pe
  LEFT JOIN dbo.imTiposPedidosEstudios tp ON tp.IdTipoPedido = pe.IdTipoPedido
  LEFT JOIN dbo.imNomenclador nom ON nom.IDPractica = pe.IdPractica
  LEFT JOIN dbo.imPersonal per ON per.Matricula = pe.ValorProfesional
  LEFT JOIN dbo.imSectores secSol ON LTRIM(RTRIM(secSol.Valor)) = LTRIM(RTRIM(pe.IdSectorSolicitante))
  LEFT JOIN dbo.imSectores secRec ON LTRIM(RTRIM(secRec.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor))
  LEFT JOIN dbo.imServicios srv ON LTRIM(RTRIM(srv.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor));
  ');
  PRINT 'Vista: vw_iMedic_PedidosEstudiosBase';
END
ELSE
  PRINT 'AVISO: imPedidosEstudios no existe — vistas de pedidos omitidas';
GO

IF OBJECT_ID(N'dbo.vw_iMedic_PedidosEstudiosBase', N'V') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'dbo.vw_iMedic_PedidosEstudiosImagen', N'V') IS NOT NULL
    DROP VIEW dbo.vw_iMedic_PedidosEstudiosImagen;
  IF OBJECT_ID(N'dbo.vw_iMedic_PedidosInterconsultas', N'V') IS NOT NULL
    DROP VIEW dbo.vw_iMedic_PedidosInterconsultas;
END
GO

IF OBJECT_ID(N'dbo.vw_iMedic_PedidosEstudiosBase', N'V') IS NOT NULL
BEGIN
  EXEC(N'
  CREATE VIEW dbo.vw_iMedic_PedidosEstudiosImagen AS
  SELECT * FROM dbo.vw_iMedic_PedidosEstudiosBase
  WHERE IdTipoPedido IS NULL OR IdTipoPedido <> 33;
  ');
  EXEC(N'
  CREATE VIEW dbo.vw_iMedic_PedidosInterconsultas AS
  SELECT * FROM dbo.vw_iMedic_PedidosEstudiosBase
  WHERE IdTipoPedido = 33;
  ');
  PRINT 'Vistas: vw_iMedic_PedidosEstudiosImagen / Interconsultas';
END
GO

/*------------------------------------------------------------------------------
  RESUMEN
------------------------------------------------------------------------------*/
PRINT '';
PRINT '=== Resumen objetos SaaS (tenant) ===';
SELECT name, type_desc
FROM sys.objects
WHERE schema_id = SCHEMA_ID('dbo')
  AND name IN (
    'imTurneroPantalla', 'imTurneroLlamado',
    'imNotificaciones', 'imHCInterconsulta',
    'imBotConfig', 'imBotChat',
    'imHCExamenesLabCabecera', 'imHCExamenesLabDetalle', 'imHCExamenesLabDetalleConf',
    'fn_ClarionDATE2SQL', 'fn_GetIndicadores', 'fn_OcupacionPromedioCamas',
    'vw_iMedic_PedidosEstudiosBase', 'vw_iMedic_PedidosEstudiosImagen', 'vw_iMedic_PedidosInterconsultas'
  )
ORDER BY type_desc, name;
GO

PRINT '=== iMedic SaaS tenant delta — FIN OK ===';
PRINT 'Siguiente: en MySQL Railway ejecutá scripts/sql/setup_saas_mysql_delta.sql';
GO
