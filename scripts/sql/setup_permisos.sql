-- ============================================================
-- PERMISOS — Tablas dbo.imPermisos y dbo.imRolPermisos
-- Idempotente: se puede correr varias veces sin duplicar.
--
-- El seeding (insertar la matriz desde código) lo hace
-- `node scripts/seed_permisos.js` para mantener UNA sola fuente
-- de verdad: `src/utils/permisos.js`.
-- ============================================================

-- 1) Catálogo plano de permisos
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imPermisos'
)
BEGIN
    CREATE TABLE dbo.imPermisos (
        IdPermiso     INT IDENTITY(1,1) PRIMARY KEY,
        Codigo        VARCHAR(120) NOT NULL UNIQUE, -- 'INTERNACION.CAMAS.GESTIONAR'
        Modulo        VARCHAR(40)  NOT NULL,
        Submodulo     VARCHAR(40)  NOT NULL,
        Accion        VARCHAR(20)  NOT NULL,
        Descripcion   VARCHAR(200) NULL,
        FechaCreacion DATETIME     NOT NULL DEFAULT GETDATE()
    );

    CREATE INDEX IX_imPermisos_ModSub ON dbo.imPermisos (Modulo, Submodulo);
END;

-- 2) Relación rol -> permisos (plantillas)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imRolPermisos'
)
BEGIN
    CREATE TABLE dbo.imRolPermisos (
        IdRol     INT NOT NULL,
        IdPermiso INT NOT NULL,
        FechaAsignacion DATETIME NOT NULL DEFAULT GETDATE(),
        PRIMARY KEY (IdRol, IdPermiso),
        FOREIGN KEY (IdRol)     REFERENCES dbo.imRoles(IdRol),
        FOREIGN KEY (IdPermiso) REFERENCES dbo.imPermisos(IdPermiso)
    );
END;
