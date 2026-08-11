-- Multi-rol por personal (Railway auth central)
-- Ejecutar una vez en la DB de auth si la tabla aún no existe.
-- setup_auth_mysql.sql ya incluye esta definición para installs nuevos.

CREATE TABLE IF NOT EXISTS `imPersonalRoles` (
  `IdEmpresa` INT NOT NULL,
  `Valor` INT NOT NULL,
  `IdRol` INT NOT NULL,
  `EsPrincipal` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`IdEmpresa`, `Valor`, `IdRol`),
  KEY `IX_imPersonalRoles_Rol` (`IdRol`),
  KEY `IX_imPersonalRoles_Personal` (`IdEmpresa`, `Valor`, `EsPrincipal`)
);

-- Backfill desde imPersonal.Rol (rol único previo)
INSERT IGNORE INTO `imPersonalRoles` (`IdEmpresa`, `Valor`, `IdRol`, `EsPrincipal`)
SELECT
  p.`IdEmpresa`,
  p.`Valor`,
  CAST(TRIM(p.`Rol`) AS UNSIGNED),
  1
FROM `imPersonal` p
WHERE p.`Rol` IS NOT NULL
  AND TRIM(p.`Rol`) <> ''
  AND CAST(TRIM(p.`Rol`) AS UNSIGNED) > 0;
