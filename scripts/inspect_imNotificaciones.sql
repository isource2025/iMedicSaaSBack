/*
  Solo diagnóstico (no modifica datos).
  Ejecutar en la misma base que usa el backend para ver el esquema real Aclysa / legacy.
  Copie los nombres de columna en .env si hace falta:
    NOTIFICACIONES_COL_VALOR_PERSONAL=...
    NOTIFICACIONES_COL_LEIDA=...
*/
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imNotificaciones'
ORDER BY ORDINAL_POSITION;
