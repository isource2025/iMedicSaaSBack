-- Ampliar imBotConfig.Valor para tokens cifrados (WhatsApp access token, etc.)
-- Idempotente — SQL Server tenant.

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotConfig'
    AND COLUMN_NAME = 'Valor'
    AND (DATA_TYPE NOT IN ('nvarchar', 'varchar') OR CHARACTER_MAXIMUM_LENGTH <> -1)
)
BEGIN
  ALTER TABLE dbo.imBotConfig ALTER COLUMN Valor NVARCHAR(MAX) NULL;
  PRINT 'OK: imBotConfig.Valor → NVARCHAR(MAX)';
END
ELSE IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imBotConfig' AND COLUMN_NAME = 'Valor'
)
  PRINT 'OK: imBotConfig.Valor ya es NVARCHAR(MAX)';
GO
