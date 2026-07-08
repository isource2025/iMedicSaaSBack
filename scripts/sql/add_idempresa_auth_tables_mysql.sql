-- Multi-tenancy de auth en Railway (MySQL).
-- imPassword, imPersonal e imPersonalSectores pasan a PK compuesta con IdEmpresa,
-- de modo que el id de persona en Railway = id en el servidor físico de cada empresa.
--
-- El runner idempotente es scripts/apply_auth_idempresa.js (no ejecutar este archivo a mano en prod).

-- imPersonal: PK (IdEmpresa, Valor)
-- imPassword: PK (IdEmpresa, ValorPersonal)
-- imPersonalSectores: PK (IdEmpresa, idPersonal, idSector)
