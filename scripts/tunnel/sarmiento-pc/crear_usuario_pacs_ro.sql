-- Correr en SSMS conectado a la instancia SQLCC, como sa / Administrador.
-- Crea un login de SOLO LECTURA para el bridge iMedic (pacs-bridge.js).
-- CAMBIÁ la contraseña antes de ejecutar.

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'imedic_pacs_ro')
BEGIN
  CREATE LOGIN [imedic_pacs_ro] WITH PASSWORD = N'CAMBIAR_ESTA_CLAVE_FORTE',
    CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF;
END
GO

USE [ImageServer];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'imedic_pacs_ro')
BEGIN
  CREATE USER [imedic_pacs_ro] FOR LOGIN [imedic_pacs_ro];
END
GO

ALTER ROLE db_datareader ADD MEMBER [imedic_pacs_ro];
GO

-- Verificación
SELECT dp.name AS Usuario, r.name AS Rol
FROM sys.database_role_members m
JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals dp ON dp.principal_id = m.member_principal_id
WHERE dp.name = N'imedic_pacs_ro';
GO
