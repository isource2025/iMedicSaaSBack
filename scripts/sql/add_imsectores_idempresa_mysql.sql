-- Multi-tenancy de sectores en la nube (Railway / MySQL).
-- Antes: imSectores tenía PK = Valor (código), o sea sectores GLOBALES: dos empresas
-- con el mismo código (p.ej. "URG") se pisaban entre sí.
-- Ahora: se agrega IdEmpresa y la PK pasa a ser (IdEmpresa, Valor), de modo que cada
-- empresa tiene su propio catálogo de sectores aislado.
--
-- Las filas existentes se asignan a la empresa 1 (tenant real/legado actual).
-- Este script es idempotente: el runner (apply_imsectores_idempresa.js) verifica el
-- estado antes de aplicar cada paso.

ALTER TABLE `imSectores` ADD COLUMN `IdEmpresa` INT NOT NULL DEFAULT 1;

UPDATE `imSectores` SET `IdEmpresa` = 1 WHERE `IdEmpresa` IS NULL OR `IdEmpresa` = 0;

ALTER TABLE `imSectores` DROP PRIMARY KEY, ADD PRIMARY KEY (`IdEmpresa`, `Valor`);
