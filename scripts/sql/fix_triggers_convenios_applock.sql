/*
 * Triggers de sincronización de imPracticasXConvenios.
 *
 * Los originales tomaban sp_getapplock con @LockOwner = 'Session' y nunca lo
 * liberaban: la primera conexión que disparaba el trigger quedaba dueña del
 * lock y en cualquier otra conexión (pool de Node, otra PC con Clarion) el
 * trigger salía sin sincronizar y sin avisar.
 *
 * Con @LockOwner = 'Transaction' el lock se libera solo al terminar la
 * transacción de la sentencia que disparó el trigger. Si otro guardado está
 * sincronizando, se espera hasta 60 s; si no se consigue, la sentencia falla en
 * lugar de dejar imPracticasXConvenios desactualizada.
 *
 * Vuelta atrás: rollback_triggers_convenios_applock.sql (pendiente, ver docs/FACTURACION_CONVENIOS.md, fase 0).
 */

ALTER TRIGGER [dbo].[TRG_Sync_ClientesConvNomenc]
ON [dbo].[imClientesConvNomenc]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @LockResult INT;
    EXEC @LockResult = sp_getapplock
        @Resource = 'SyncPracticasXConvenio',
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 60000;

    IF @LockResult < 0
    BEGIN
        RAISERROR('No se pudo sincronizar imPracticasXConvenios: hay otra sincronización en curso. Reintentá.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END

    ;WITH C AS (
        SELECT ValorConvenio FROM inserted
        UNION
        SELECT ValorConvenio FROM deleted
    )
    SELECT DISTINCT ValorConvenio
    INTO #T
    FROM C;

    DECLARE @v INT;
    WHILE EXISTS (SELECT 1 FROM #T)
    BEGIN
        SELECT TOP 1 @v = ValorConvenio FROM #T;
        EXEC dbo.SyncPracticasXConvenio @v;
        DELETE FROM #T WHERE ValorConvenio = @v;
    END
END
GO

ALTER TRIGGER [dbo].[TRG_Sync_ClientesConvModuladas]
ON [dbo].[imClientesConvModuladas]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @LockResult INT;
    EXEC @LockResult = sp_getapplock
        @Resource = 'SyncPracticasXConvenio',
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 60000;

    IF @LockResult < 0
    BEGIN
        RAISERROR('No se pudo sincronizar imPracticasXConvenios: hay otra sincronización en curso. Reintentá.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END

    ;WITH C AS (
        SELECT ValorConvenio FROM inserted
        UNION
        SELECT ValorConvenio FROM deleted
    )
    SELECT DISTINCT ValorConvenio
    INTO #T
    FROM C;

    DECLARE @v INT;
    WHILE EXISTS (SELECT 1 FROM #T)
    BEGIN
        SELECT TOP 1 @v = ValorConvenio FROM #T;
        EXEC dbo.SyncPracticasXConvenio @v;
        DELETE FROM #T WHERE ValorConvenio = @v;
    END
END
GO
