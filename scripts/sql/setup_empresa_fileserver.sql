-- ============================================================
-- Empresas.FileServerUrl — túnel / file server de adjuntos por empresa
-- SQL Server (plataforma legacy)
-- ============================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'FileServerUrl'
)
    ALTER TABLE dbo.Empresas ADD FileServerUrl NVARCHAR(500) NULL;

PRINT 'OK: Empresas.FileServerUrl';
