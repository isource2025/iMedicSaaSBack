/**
 * Servicio para gestión de movimientos de visitas
 * @module services/visitaMovimientos.service
 */
const { executeQuery } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');

/**
 * Obtiene el último movimiento de una visita
 */
async function obtenerUltimoMovimientoVisita(numeroVisita) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error(`Visita inválida: ${numeroVisita}`);

  const sql = `
    SELECT TOP 1
      NumeroVisita, FechaAdmision, HoraAdmision,
      FechaEgreso, HoraEgreso, DisposicionEgreso, Diagnostico
    FROM imVisitaMovimiento
    WHERE NumeroVisita = @p0
    ORDER BY FechaAdmision DESC, HoraAdmision DESC
  `;
  const rows = await executeQuery(sql, [{ value: num }]);
  return rows[0] || null;
}

/**
 * Actualiza el último movimiento (egreso + disposición + diagnóstico)
 * y libera la cama asociada (bedId)
 */
/**
 * Actualiza el último movimiento de una visita y libera la cama asociada.
 * @param {string|number} numeroVisita - ID de la visita
 * @param {Object} datosEgreso - { fechaEgreso, horaEgreso, disposicionEgreso, diagnostico, bedId }
 * @returns {Promise<Object>} - Resultado con datos actualizados
 */
async function actualizarUltimoMovimientoVisita(numeroVisita, datosEgreso) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error('Visita inválida');

  const { fechaEgreso, horaEgreso, disposicionEgreso, diagnostico, bedId } = datosEgreso;
  if (!fechaEgreso || !horaEgreso || !disposicionEgreso || !bedId) {
    throw new Error('Faltan datos obligatorios');
  }

  const cDate = convertirFechaAClarion(fechaEgreso);
  const cTime = convertirHoraAClarion(horaEgreso);

  const ultimo = await obtenerUltimoMovimientoVisita(num);
  if (!ultimo) {
    throw new Error(`No se encontró movimiento anterior para la visita ${num}`);
  }

  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;

      -- Actualizar movimiento
      UPDATE imVisitaMovimiento
      SET 
        FechaEgreso = @param1,
        HoraEgreso = @param2,
        DisposicionEgreso = @param5,
        Diagnostico = @param6
      WHERE 
        NumeroVisita   = @param0 AND
        FechaAdmision = @param3 AND
        HoraAdmision  = @param4;

      -- Liberar cama
      UPDATE imHabitacionCamas
      SET 
        FechaIngreso      = 0,
        FechaEgreso       = @param1,
        ValorEstadoCama   = 'U',
        NumeroVisita      = 0,
        Observaciones     = ''
      WHERE ValorHabitacionCama = @param7;

            -- Liberar cama
      UPDATE imVisita
      SET 
        FechaEgreso = @param1,
        HoraEgreso = @param2,
        DisposicionEgreso = @param5,
        DiagnosticoEgreso = @param6
      WHERE NumeroVisita = @param0;
    
      COMMIT;
    END TRY
    BEGIN CATCH
      ROLLBACK;
      THROW;
    END CATCH;
  `;

  const params = [
    { value: num }, // @param0
    { value: cDate }, // @param1
    { value: cTime }, // @param2
    { value: ultimo.FechaAdmision }, // @param3
    { value: ultimo.HoraAdmision }, // @param4
    { value: disposicionEgreso }, // @param5
    { value: diagnostico || null }, // @param6
    { value: bedId } // @param7
  ];

  try {
    await executeQuery(query, params);

    const actualizado = await obtenerUltimoMovimientoVisita(num);
    return {
      success: true,
      message: 'Movimiento actualizado y cama liberada',
      data: actualizado
    };
  } catch (err) {
    console.error('Error en transacción de egreso:', err);
    throw new Error('Error al actualizar el último movimiento de la visita');
  }
}




/**
 * Obtiene todos los movimientos de una visita
 */
async function obtenerMovimientosVisita(numeroVisita) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error(`Visita inválida: ${numeroVisita}`);

  const sql = `
    SELECT
      NumeroVisita, FechaAdmision, HoraAdmision,
      FechaEgreso, HoraEgreso, DisposicionEgreso
    FROM imVisitaMovimiento
    WHERE NumeroVisita = @p0
    ORDER BY FechaAdmision DESC, HoraAdmision DESC
  `;
  return await executeQuery(sql, [{ value: num }]);
}

module.exports = {
  obtenerUltimoMovimientoVisita,
  actualizarUltimoMovimientoVisita,
  obtenerMovimientosVisita
};
