-- Vincular adjuntos a turnos de agenda antes del cierre (NumeroVisita = 0)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'imPedidosEstudiosAdjuntos' AND COLUMN_NAME = 'IdTurno'
)
BEGIN
  ALTER TABLE dbo.imPedidosEstudiosAdjuntos ADD IdTurno INT NULL;
  PRINT 'Columna IdTurno agregada.';
END
ELSE
  PRINT 'Columna IdTurno ya existe.';
