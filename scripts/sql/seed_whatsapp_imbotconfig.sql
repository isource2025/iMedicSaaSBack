-- SQL Server tenant — claves WhatsApp en imBotConfig
-- Espejo operativo / fallback local (AUTH_DB=0). En nube la fuente de verdad
-- para enrutamiento global es MySQL Empresas.WhatsAppPhoneNumberId.
-- Requiere: create_bot_tables.sql + alter_imBotConfig_valor_max.sql

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'whatsapp_phone_number_id' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('whatsapp_phone_number_id', '', 'string');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'whatsapp_waba_id' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('whatsapp_waba_id', '', 'string');

IF NOT EXISTS (SELECT 1 FROM dbo.imBotConfig WHERE Clave = 'whatsapp_access_token_enc' AND Activo = 1)
  INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo) VALUES ('whatsapp_access_token_enc', '', 'string');
GO
