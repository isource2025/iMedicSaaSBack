-- Operadores que marcan llegada / ingreso al consultorio (trazabilidad agenda).
IF COL_LENGTH('dbo.imTurnos', 'OperadorLlegada') IS NULL
    ALTER TABLE dbo.imTurnos ADD OperadorLlegada INT NULL;
GO
  IF COL_LENGTH('dbo.imTurnos', 'OperadorIngreso') IS NULL
    ALTER TABLE dbo.imTurnos ADD OperadorIngreso INT NULL;
GO
IF COL_LENGTH('dbo.imTurnos', 'OperadorCancelacion') IS NULL
    ALTER TABLE dbo.imTurnos ADD OperadorCancelacion INT NULL;
GO
IF COL_LENGTH('dbo.imTurnos', 'OrigenCancelacion') IS NULL
    ALTER TABLE dbo.imTurnos ADD OrigenCancelacion VARCHAR(12) NULL;
GO
