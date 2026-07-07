-- Agrega la columna TipoServidor a Empresas (MySQL / Railway).
-- NUBE  = todos los datos de la clínica viven en Railway (base compartida multi-tenant).
-- FISICO = la clínica corre sobre su propio SQL Server on-premise (DbServer/DbName/...).
-- Las empresas existentes quedan como FISICO (comportamiento actual).
ALTER TABLE `Empresas`
  ADD COLUMN `TipoServidor` VARCHAR(10) NOT NULL DEFAULT 'FISICO';
