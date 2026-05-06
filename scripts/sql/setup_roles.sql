-- ============================================================
-- ROLES — Catálogo de roles del sistema (imRoles)
-- + Migración inicial al campo imPersonal.Rol (varchar(20))
--
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================

-- 1) Crear tabla imRoles si no existe
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imRoles'
)
BEGIN
    CREATE TABLE dbo.imRoles (
        IdRol           INT             NOT NULL PRIMARY KEY,
        Nombre          VARCHAR(50)     NOT NULL UNIQUE,
        Descripcion     VARCHAR(200)    NULL,
        Nivel           TINYINT         NOT NULL DEFAULT 0,
        Activo          BIT             NOT NULL DEFAULT 1,
        FechaCreacion   DATETIME        NOT NULL DEFAULT GETDATE()
    );
END;

-- 2) Insertar los 4 roles iniciales con IDs FIJOS (idempotente)
IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 1)
    INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel)
    VALUES (1, 'ADMIN', 'Administrador del sistema', 100);

IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 2)
    INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel)
    VALUES (2, 'MEDICO', 'Médico / profesional de salud', 50);

IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 3)
    INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel)
    VALUES (3, 'ENFERMERO', 'Personal de enfermería', 40);

IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 4)
    INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel)
    VALUES (4, 'ADMINISTRATIVO', 'Personal administrativo', 20);

-- ============================================================
-- 3) Migración inicial al campo imPersonal.Rol (varchar(20))
--    Sólo asigna a quienes hoy NO tienen rol (NULL o vacío).
-- ============================================================

-- 3a) ADMIN: usuarios con imPassword.Grupo = 11 (admin legacy)
UPDATE p
SET    p.Rol = '1'
FROM   dbo.imPersonal p
INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = p.Valor
WHERE  pw.Grupo = 11
  AND  (p.Rol IS NULL OR LTRIM(RTRIM(p.Rol)) = '');

-- 3b) ENFERMERO: ValorEspecialidad = 26
UPDATE p
SET    p.Rol = '3'
FROM   dbo.imPersonal p
WHERE  p.ValorEspecialidad = 26
  AND  (p.Rol IS NULL OR LTRIM(RTRIM(p.Rol)) = '');

-- 3c) MEDICO: cualquier otra especialidad médica (>0) que no sea 26 (enfermero)
--     ni 7/9/27 (técnicos — quedan sin rol porque TECNICO no se creó en esta fase).
UPDATE p
SET    p.Rol = '2'
FROM   dbo.imPersonal p
WHERE  p.ValorEspecialidad IS NOT NULL
  AND  p.ValorEspecialidad > 0
  AND  p.ValorEspecialidad NOT IN (7, 9, 26, 27)
  AND  (p.Rol IS NULL OR LTRIM(RTRIM(p.Rol)) = '');

-- 4) Diagnóstico final
SELECT
    r.IdRol,
    r.Nombre,
    COUNT(p.Valor) AS PersonalAsignado
FROM   dbo.imRoles r
LEFT JOIN dbo.imPersonal p ON LTRIM(RTRIM(ISNULL(p.Rol, ''))) = CONVERT(VARCHAR(20), r.IdRol)
GROUP BY r.IdRol, r.Nombre
ORDER BY r.IdRol;

SELECT
    SUM(CASE WHEN p.Rol IS NULL OR LTRIM(RTRIM(p.Rol)) = '' THEN 1 ELSE 0 END) AS SinRol,
    COUNT(*) AS Total
FROM dbo.imPersonal p;
