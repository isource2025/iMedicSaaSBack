/**
 * Servicio para gestión de movimientos de visitas
 * @module services/visitaMovimientos.service
 */
const { executeQuery } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion, convertirFechaClarionADate, convertirHoraClarionAString } = require('../utils/dateUtils');

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

async function actualizarUltimoMovimientoVisita(numeroVisita, datosEgreso) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error('Visita inválida');

  const { fechaEgreso, horaEgreso, disposicionEgreso, diagnostico, bedId } = datosEgreso;
  
  // Validar los campos obligatorios que envía el frontend
  if (!fechaEgreso || !horaEgreso) {
    throw new Error('Faltan datos obligatorios: fecha y hora de egreso');
  }
  
  // Para compatibilidad con el frontend, usamos disposicionEgreso como estadoAmbulatorio si no se proporciona
  const estadoAmbulatorio = disposicionEgreso || 1; // Valor predeterminado 1 si no se proporciona
  const codigoOperador = 'SISTEMA'; // Valor predeterminado si no se proporciona

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
        EstadoAmbulatorio = @param5,
        Diagnostico = @param6,
        Operador = @param7
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
      WHERE ValorHabitacionCama = @param8;

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
    { value: estadoAmbulatorio }, // @param5
    { value: diagnostico || null }, // @param6
    { value: codigoOperador }, // @param7
    { value: bedId } // @param8
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
 * Mueve un paciente de una cama a otra, actualizando todos los registros necesarios
 * @param {number} numeroVisita - Número de visita del paciente
 * @param {Object} datos - Datos para el movimiento
 * @param {number} datos.FechaAdmision - Fecha de admisión (formato Clarion)
 * @param {number} datos.HoraAdmision - Hora de admisión (formato Clarion)
 * @param {number} datos.FechaEgreso - Fecha de egreso (formato Clarion)
 * @param {number} datos.HoraEgreso - Hora de egreso (formato Clarion)
 * @param {string} datos.EstadoAmbulatorio - Código del estado ambulatorio
 * @param {string} datos.Diagnostico - Código del diagnóstico
 * @param {string} datos.bedId - ID de la cama destino
 * @param {string} datos.ValorSector - Sector de la cama destino
 * @param {string} datos.Operador - Código del operador
 * @param {number} datos.FechaCarga - Fecha de carga (formato Clarion)
 * @param {number} datos.HoraCarga - Hora de carga (formato Clarion)
 * @returns {Promise<Object>} - Resultado de la operación
 */
async function moverPacienteACamaVacia(numeroVisita, datos) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error('Número de visita inválido');

  // Validar datos requeridos
  const { 
    FechaAdmision, 
    HoraAdmision, 
    FechaEgreso, 
    HoraEgreso, 
    EstadoAmbulatorio, 
    Diagnostico, 
    bedId, 
    ValorSector, // Campo obligatorio para el sector
    Operador,
    FechaCarga,
    HoraCarga 
  } = datos;

  if (!FechaAdmision || !HoraAdmision || !FechaEgreso || !HoraEgreso || 
      !EstadoAmbulatorio || !bedId || !ValorSector || !Operador || !FechaCarga || !HoraCarga) {
    throw new Error('Faltan datos obligatorios para el movimiento de cama. Se requiere: FechaAdmision, HoraAdmision, FechaEgreso, HoraEgreso, EstadoAmbulatorio, bedId, ValorSector, Operador, FechaCarga, HoraCarga');
  }

  // Obtener información del último movimiento para cerrar el registro actual
  const ultimoMovimiento = await obtenerUltimoMovimientoVisita(num);
  if (!ultimoMovimiento) {
    throw new Error(`No se encontró el último movimiento para la visita ${num}`);
  }
  
  // Obtener información del paciente de la visita
  const pacienteQuery = `
    SELECT IDPaciente, FechaAdmisionS
    FROM imVisita
    WHERE NumeroVisita = @param0
  `;
  
  const pacienteResult = await executeQuery(pacienteQuery, [{ value: num }]);
  if (!pacienteResult || pacienteResult.length === 0) {
    throw new Error(`No se encontró información del paciente para la visita ${num}`);
  }
  
  const idPaciente = pacienteResult[0].IDPaciente;
  const fechaAdmisionS = pacienteResult[0].FechaAdmisionS;

  // Obtener información de la cama actual para liberarla
  const camaActualQuery = `
    SELECT ValorHabitacionCama, ValorSector 
    FROM imHabitacionCamas 
    WHERE NumeroVisita = @param0
  `;
  
  const camaActualResult = await executeQuery(camaActualQuery, [{ value: num }]);
  if (!camaActualResult || camaActualResult.length === 0) {
    throw new Error(`No se encontró la cama actual para la visita ${num}`);
  }
  
  const camaActual = camaActualResult[0].ValorHabitacionCama;
  const sectorActual = camaActualResult[0].ValorSector;
  
  // En lugar de obtener todos los estados de cama disponibles, simplemente verificaremos
  // si la cama específica que queremos usar tiene el estado 'U' (libre)
  console.log(`Verificando disponibilidad de la cama ${bedId} en el sector ${ValorSector}`);
  
  // Verificar que la cama destino exista y esté disponible
  const camaDestinoQuery = `
    SELECT c.ValorHabitacionCama, c.ValorSector, c.ValorEstadoCama, e.Descripcion as EstadoDescripcion 
    FROM imHabitacionCamas c
    LEFT JOIN imEstadoCama e ON c.ValorEstadoCama = e.Valor
    WHERE c.ValorHabitacionCama = @param0 AND c.ValorSector = @param1
  `;
  
  const camaDestinoResult = await executeQuery(camaDestinoQuery, [
    { value: bedId },
    { value: ValorSector }
  ]);
  
  if (!camaDestinoResult || camaDestinoResult.length === 0) {
    throw new Error(`La cama destino ${bedId} en el sector ${ValorSector} no existe`);
  }
  
  const estadoCama = camaDestinoResult[0].ValorEstadoCama;
  console.log(`Estado de la cama ${bedId} en el sector ${ValorSector}: ${estadoCama}`);
  
  // Verificar si la cama está libre (estado 'U')
  if (estadoCama !== 'U') {
    throw new Error(`La cama destino ${bedId} en el sector ${ValorSector} no está disponible. Estado actual: ${camaDestinoResult[0].EstadoDescripcion || estadoCama}`);
  }
  
  // Usar el sector proporcionado (ahora obligatorio)
  const sectorDestino = ValorSector;
  
  // Verificar que el sector coincida con el de la cama en la base de datos
  const sectorCamaEnBD = camaDestinoResult[0].ValorSector;
  if (sectorDestino !== sectorCamaEnBD) {
    console.warn(`Advertencia: El sector proporcionado (${sectorDestino}) no coincide con el sector de la cama en la base de datos (${sectorCamaEnBD})`);
  }
  
  console.log(`Sector destino: ${sectorDestino}`);


  // Realizar la transacción para mover al paciente
  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;
      
      -- 1. Cerrar el movimiento actual en imVisitaMovimiento
      UPDATE imVisitaMovimiento
      SET 
        FechaEgreso = @param0,
        HoraEgreso = @param1,
        EstadoAmbulatorio = @param2,
        Diagnostico = @param3,
        Operador = @param4
      WHERE 
        NumeroVisita = @param5 AND
        FechaAdmision = @param6 AND
        HoraAdmision = @param7;
      
      -- 2. Liberar la cama actual
      UPDATE imHabitacionCamas
      SET 
        FechaIngreso = 0,
        FechaEgreso = 0,
        ValorEstadoCama = 'U', -- Estado "Libre"
        NumeroVisita = 0,
        Observaciones = ''
      WHERE ValorHabitacionCama = @param8;
      
      -- 3. Crear un nuevo registro en imVisitaMovimiento para la nueva ubicación
      -- Verificar si ya existe un registro con esa combinación de NumeroVisita, FechaAdmision y HoraAdmision
      IF NOT EXISTS (
        SELECT 1 FROM imVisitaMovimiento 
        WHERE NumeroVisita = @param5 AND FechaAdmision = @param9 AND HoraAdmision = @param10
      )
      BEGIN
        INSERT INTO imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision, 
          EstadoAmbulatorio, Diagnostico, Operador, 
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama
        )
        VALUES (
          @param5, @param9, @param10, 
          @param2, @param3, @param4, 
          @param11, @param12, @param14, @param13, 'O'
        );
      END
      ELSE
      BEGIN
        -- Si ya existe, modificamos ligeramente la hora de admisión para evitar duplicados
        DECLARE @NuevaHoraAdmision int = @param10 + 1;
        
        INSERT INTO imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision, 
          EstadoAmbulatorio, Diagnostico, Operador, 
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama
        )
        VALUES (
          @param5, @param9, @NuevaHoraAdmision, 
          @param2, @param3, @param4, 
          @param11, @param12, @param14, @param13, 'O'
        );
      END;
      
      -- 4. Actualizar la cama destino
      UPDATE imHabitacionCamas
      SET 
        FechaIngreso = @param9,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param5,
        Observaciones = 'Traslado desde cama ' + @param8
      WHERE ValorHabitacionCama = @param13;
      
      -- 5. Actualizar la visita con la nueva ubicación
      UPDATE imVisita
      SET 
        FechaEgreso = 0,
        HoraEgreso = 0,
        ValorHabitacionCama = @param13,
        ValorSector = @param14,
        EstadoAmbulatorio = @param2,
        Diagnostico = @param3,
        Operador = @param4
      WHERE NumeroVisita = @param5;
      
      COMMIT;
    END TRY
    BEGIN CATCH
      ROLLBACK;
      THROW;
    END CATCH;
  `;

  const params = [
    { value: FechaEgreso },                 // @param0 - FechaEgreso
    { value: HoraEgreso },                  // @param1 - HoraEgreso
    { value: EstadoAmbulatorio },           // @param2 - EstadoAmbulatorio
    { value: Diagnostico || null },         // @param3 - Diagnostico
    { value: Operador },                    // @param4 - Operador
    { value: num },                         // @param5 - NumeroVisita
    { value: ultimoMovimiento.FechaAdmision }, // @param6 - UltimaFechaAdmision
    { value: ultimoMovimiento.HoraAdmision },  // @param7 - UltimaHoraAdmision
    { value: camaActual },                  // @param8 - CamaActual
    { value: FechaAdmision },               // @param9 - FechaAdmision
    { value: HoraAdmision },                // @param10 - HoraAdmision
    { value: FechaCarga },                  // @param11 - FechaCarga
    { value: HoraCarga },                   // @param12 - HoraCarga
    { value: bedId },                       // @param13 - CamaDestino
    { value: sectorDestino }                // @param14 - SectorDestino
  ];

  try {
    await executeQuery(query, params);
    
    // Obtener el nuevo movimiento para confirmar
    const nuevoMovimiento = await obtenerUltimoMovimientoVisita(num);
    
    return {
      success: true,
      message: 'Paciente trasladado exitosamente a la nueva cama',
      data: {
        numeroVisita: num,
        camaAnterior: camaActual,
        camaNueva: bedId,
        movimiento: nuevoMovimiento
      }
    };
  } catch (err) {
    console.error('Error en la transacción de traslado:', err);
    throw new Error(`Error al trasladar al paciente: ${err.message}`);
  }
}
/**
 * Intercambia las camas entre dos pacientes
 * @param {number} numeroVisita1 - Número de visita del primer paciente
 * @param {number} numeroVisita2 - Número de visita del segundo paciente
 * @param {Object} datos - Datos para el intercambio
 * @param {number} datos.FechaEgreso - Fecha de egreso (formato Clarion)
 * @param {number} datos.HoraEgreso - Hora de egreso (formato Clarion)
 * @param {number} datos.FechaAdmision - Fecha de admisión (formato Clarion)
 * @param {number} datos.HoraAdmision - Hora de admisión (formato Clarion)
 * @param {string} datos.EstadoAmbulatorio - Código del estado ambulatorio
 * @param {string} datos.Diagnostico - Código del diagnóstico
 * @param {string} datos.Operador - Código del operador
 * @param {number} datos.FechaCarga - Fecha de carga (formato Clarion)
 * @param {number} datos.HoraCarga - Hora de carga (formato Clarion)
 * @returns {Promise<Object>} - Resultado de la operación
 */
async function intercambiarCamasPacientes(numeroVisita1, numeroVisita2, datos) {
  const num1 = parseInt(numeroVisita1, 10);
  const num2 = parseInt(numeroVisita2, 10);
  
  if (isNaN(num1) || isNaN(num2)) {
    throw new Error('Números de visita inválidos');
  }
  
  if (num1 === num2) {
    throw new Error('No se puede intercambiar un paciente consigo mismo');
  }

  // Validar datos requeridos
  const { 
    FechaEgreso, 
    HoraEgreso, 
    FechaAdmision, 
    HoraAdmision, 
    EstadoAmbulatorio, 
    Diagnostico, 
    Operador,
    FechaCarga,
    HoraCarga 
  } = datos;

  if (!FechaEgreso || !HoraEgreso || !FechaAdmision || !HoraAdmision || 
      !EstadoAmbulatorio || !Operador || !FechaCarga || !HoraCarga) {
    throw new Error('Faltan datos obligatorios para el intercambio de camas');
  }

  // Obtener información del último movimiento para ambos pacientes
  const ultimoMovimiento1 = await obtenerUltimoMovimientoVisita(num1);
  const ultimoMovimiento2 = await obtenerUltimoMovimientoVisita(num2);
  
  if (!ultimoMovimiento1 || !ultimoMovimiento2) {
    throw new Error(`No se encontró el último movimiento para alguna de las visitas`);
  }
  
  // Obtener información de las camas actuales
  const camasQuery = `
    SELECT v.NumeroVisita, hc.ValorHabitacionCama, hc.ValorSector, v.IDPaciente
    FROM imHabitacionCamas hc
    JOIN imVisita v ON hc.NumeroVisita = v.NumeroVisita
    WHERE v.NumeroVisita IN (@param0, @param1)
  `;
  
  const camasResult = await executeQuery(camasQuery, [
    { value: num1 },
    { value: num2 }
  ]);
  
  if (!camasResult || camasResult.length !== 2) {
    throw new Error(`No se encontraron las camas para ambos pacientes`);
  }
  
  // Identificar camas y sectores de cada paciente
  const paciente1 = camasResult.find(c => parseInt(c.NumeroVisita) === num1);
  const paciente2 = camasResult.find(c => parseInt(c.NumeroVisita) === num2);
  
  if (!paciente1 || !paciente2) {
    throw new Error('No se pudo identificar correctamente a los pacientes');
  }
  
  const cama1 = paciente1.ValorHabitacionCama;
  const sector1 = paciente1.ValorSector;
  const cama2 = paciente2.ValorHabitacionCama;
  const sector2 = paciente2.ValorSector;
  
  // Realizar la transacción para intercambiar pacientes
  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;
      
      -- 1. Cerrar los movimientos actuales en imVisitaMovimiento
      -- Paciente 1
      UPDATE imVisitaMovimiento
      SET 
        FechaEgreso = @param0,
        HoraEgreso = @param1,
        EstadoAmbulatorio = @param2,
        Diagnostico = @param3,
        Operador = @param4
      WHERE 
        NumeroVisita = @param5 AND
        FechaAdmision = @param6 AND
        HoraAdmision = @param7;
      
      -- Paciente 2
      UPDATE imVisitaMovimiento
      SET 
        FechaEgreso = @param0,
        HoraEgreso = @param1,
        EstadoAmbulatorio = @param2,
        Diagnostico = @param3,
        Operador = @param4
      WHERE 
        NumeroVisita = @param8 AND
        FechaAdmision = @param9 AND
        HoraAdmision = @param10;
      
      -- 2. Liberar temporalmente ambas camas (marcarlas como en proceso de intercambio)
      UPDATE imHabitacionCamas
      SET 
        NumeroVisita = 0,
        ValorEstadoCama = 'M' -- Mantenimiento temporal durante el intercambio
      WHERE ValorHabitacionCama IN (@param11, @param12);
      
      -- 3. Crear nuevos registros en imVisitaMovimiento para las nuevas ubicaciones
      -- Paciente 1 a Cama 2
      INSERT INTO imVisitaMovimiento (
        NumeroVisita, FechaAdmision, HoraAdmision, 
        EstadoAmbulatorio, Diagnostico, Operador, 
        FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama
      )
      VALUES (
        @param5, @param13, @param14, 
        @param2, @param3, @param4, 
        @param15, @param16, @param18, @param12, 'O'
      );
      
      -- Paciente 2 a Cama 1
      INSERT INTO imVisitaMovimiento (
        NumeroVisita, FechaAdmision, HoraAdmision, 
        EstadoAmbulatorio, Diagnostico, Operador, 
        FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama
      )
      VALUES (
        @param8, @param13, @param14, 
        @param2, @param3, @param4, 
        @param15, @param16, @param17, @param11, 'O'
      );
      
      -- 4. Actualizar las camas con los nuevos pacientes
      -- Cama 1 ahora con Paciente 2
      UPDATE imHabitacionCamas
      SET 
        FechaIngreso = @param13,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param8,
        Observaciones = 'Intercambio desde cama ' + @param12
      WHERE ValorHabitacionCama = @param11;
      
      -- Cama 2 ahora con Paciente 1
      UPDATE imHabitacionCamas
      SET 
        FechaIngreso = @param13,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param5,
        Observaciones = 'Intercambio desde cama ' + @param11
      WHERE ValorHabitacionCama = @param12;
      
      -- 5. Actualizar las visitas con las nuevas ubicaciones
      -- Visita 1
      UPDATE imVisita
      SET 
        FechaEgreso = 0,
        HoraEgreso = 0,
        ValorHabitacionCama = @param12,
        ValorSector = @param18,
        EstadoAmbulatorio = @param2,
        Diagnostico = @param3,
        Operador = @param4
      WHERE NumeroVisita = @param5;
      
      -- Visita 2
      UPDATE imVisita
      SET 
        FechaEgreso = 0,
        HoraEgreso = 0,
        ValorHabitacionCama = @param11,
        ValorSector = @param17,
        EstadoAmbulatorio = @param2,
        Diagnostico = @param3,
        Operador = @param4
      WHERE NumeroVisita = @param8;
      
      COMMIT;
    END TRY
    BEGIN CATCH
      ROLLBACK;
      THROW;
    END CATCH;
  `;

  const params = [
    { value: FechaEgreso },                 // @param0 - FechaEgreso
    { value: HoraEgreso },                  // @param1 - HoraEgreso
    { value: EstadoAmbulatorio },           // @param2 - EstadoAmbulatorio
    { value: Diagnostico || null },         // @param3 - Diagnostico
    { value: Operador },                    // @param4 - Operador
    { value: num1 },                        // @param5 - NumeroVisita1
    { value: ultimoMovimiento1.FechaAdmision }, // @param6 - UltimaFechaAdmision1
    { value: ultimoMovimiento1.HoraAdmision },  // @param7 - UltimaHoraAdmision1
    { value: num2 },                        // @param8 - NumeroVisita2
    { value: ultimoMovimiento2.FechaAdmision }, // @param9 - UltimaFechaAdmision2
    { value: ultimoMovimiento2.HoraAdmision },  // @param10 - UltimaHoraAdmision2
    { value: cama1 },                       // @param11 - Cama1
    { value: cama2 },                       // @param12 - Cama2
    { value: FechaAdmision },               // @param13 - NuevaFechaAdmision
    { value: HoraAdmision },                // @param14 - NuevaHoraAdmision
    { value: FechaCarga },                  // @param15 - FechaCarga
    { value: HoraCarga },                   // @param16 - HoraCarga
    { value: sector1 },                     // @param17 - Sector1
    { value: sector2 }                      // @param18 - Sector2
  ];

  try {
    await executeQuery(query, params);
    
    // Obtener los nuevos movimientos para confirmar
    const nuevoMovimiento1 = await obtenerUltimoMovimientoVisita(num1);
    const nuevoMovimiento2 = await obtenerUltimoMovimientoVisita(num2);
    
    return {
      success: true,
      message: 'Intercambio de camas realizado exitosamente',
      data: {
        paciente1: {
          numeroVisita: num1,
          camaAnterior: cama1,
          camaNueva: cama2,
          movimiento: nuevoMovimiento1
        },
        paciente2: {
          numeroVisita: num2,
          camaAnterior: cama2,
          camaNueva: cama1,
          movimiento: nuevoMovimiento2
        }
      }
    };
  } catch (err) {
    console.error('Error en la transacción de intercambio de camas:', err);
    throw new Error(`Error al intercambiar las camas: ${err.message}`);
  }
}

/**
 * Obtiene los movimientos más recientes de internación (último ingreso, último egreso y último cambio de cama)
 * @param {number} limite - Número máximo de registros a devolver (default: 10)
 * @returns {Promise<Array>} - Array con los movimientos recientes
 */
async function obtenerMovimientosRecientes(limite = 10) {
  const sql = `
    WITH MovimientosRecientes AS (
      -- Últimos 10 ingresos
      SELECT TOP 10
        vm.NumeroVisita,
        vm.FechaAdmision,
        vm.HoraAdmision,
        vm.FechaEgreso,
        vm.HoraEgreso,
        vm.ValorHabitacionCama,
        vm.ValorSector,
        vm.EstadoCama,
        v.IDPaciente,
        p.ApellidoyNombre,
        p.NumeroDocumento,
        s.Descripcion as SectorDescripcion,
        'Ingreso' as TipoMovimiento,
        1 as Prioridad
      FROM imVisitaMovimiento vm
      INNER JOIN imVisita v ON vm.NumeroVisita = v.NumeroVisita
      INNER JOIN imPacientes p ON v.IDPaciente = p.IDPaciente
      LEFT JOIN imSectores s ON vm.ValorSector = s.Valor
      WHERE vm.FechaAdmision IS NOT NULL AND vm.FechaAdmision > 0
        AND (vm.FechaEgreso IS NULL OR vm.FechaEgreso = 0)
      ORDER BY vm.FechaAdmision DESC, vm.HoraAdmision DESC
      
      UNION ALL
      
      -- Últimos 10 egresos
      SELECT TOP 10
        vm.NumeroVisita,
        vm.FechaAdmision,
        vm.HoraAdmision,
        vm.FechaEgreso,
        vm.HoraEgreso,
        vm.ValorHabitacionCama,
        vm.ValorSector,
        vm.EstadoCama,
        v.IDPaciente,
        p.ApellidoyNombre,
        p.NumeroDocumento,
        s.Descripcion as SectorDescripcion,
        'Egreso' as TipoMovimiento,
        2 as Prioridad
      FROM imVisitaMovimiento vm
      INNER JOIN imVisita v ON vm.NumeroVisita = v.NumeroVisita
      INNER JOIN imPacientes p ON v.IDPaciente = p.IDPaciente
      LEFT JOIN imSectores s ON vm.ValorSector = s.Valor
      WHERE vm.FechaEgreso IS NOT NULL AND vm.FechaEgreso > 0
      ORDER BY vm.FechaEgreso DESC, vm.HoraEgreso DESC
      
      UNION ALL
      
      -- Últimos 10 movimientos de cama
      SELECT TOP 10
        vm.NumeroVisita,
        vm.FechaAdmision,
        vm.HoraAdmision,
        vm.FechaEgreso,
        vm.HoraEgreso,
        vm.ValorHabitacionCama,
        vm.ValorSector,
        vm.EstadoCama,
        v.IDPaciente,
        p.ApellidoyNombre,
        p.NumeroDocumento,
        s.Descripcion as SectorDescripcion,
        'Movimiento de cama' as TipoMovimiento,
        3 as Prioridad
      FROM imVisitaMovimiento vm
      INNER JOIN imVisita v ON vm.NumeroVisita = v.NumeroVisita
      INNER JOIN imPacientes p ON v.IDPaciente = p.IDPaciente
      LEFT JOIN imSectores s ON vm.ValorSector = s.Valor
      WHERE vm.FechaAdmision IS NOT NULL AND vm.FechaAdmision > 0
      ORDER BY vm.FechaAdmision DESC, vm.HoraAdmision DESC
    )
    SELECT 
      NumeroVisita,
      FechaAdmision,
      HoraAdmision,
      FechaEgreso,
      HoraEgreso,
      ValorHabitacionCama,
      ValorSector,
      EstadoCama,
      IDPaciente,
      ApellidoyNombre,
      NumeroDocumento,
      SectorDescripcion,
      TipoMovimiento
    FROM MovimientosRecientes
    ORDER BY 
      CASE 
        WHEN TipoMovimiento = 'Ingreso' THEN FechaAdmision
        WHEN TipoMovimiento = 'Egreso' THEN FechaEgreso
        ELSE FechaAdmision
      END DESC,
      CASE 
        WHEN TipoMovimiento = 'Ingreso' THEN HoraAdmision
        WHEN TipoMovimiento = 'Egreso' THEN HoraEgreso
        ELSE HoraAdmision
      END DESC
  `;
  
  try {
    const result = await executeQuery(sql, [{ value: limite }]);
    
    // Convertir fechas y horas Clarion usando las funciones de dateUtils
    const resultadoConFechas = result.map(row => {
      const fechaAdmision = convertirFechaClarionADate(row.FechaAdmision);
      const fechaEgreso = row.FechaEgreso && row.FechaEgreso > 0 
        ? convertirFechaClarionADate(row.FechaEgreso) 
        : null;
      
      const horaAdmision = convertirHoraClarionAString(row.HoraAdmision);
      const horaEgreso = row.HoraEgreso && row.HoraEgreso > 0
        ? convertirHoraClarionAString(row.HoraEgreso)
        : null;
      
      return {
        ...row,
        FechaAdmisionFormateada: fechaAdmision ? fechaAdmision.toISOString() : null,
        FechaEgresoFormateada: fechaEgreso ? fechaEgreso.toISOString() : null,
        HoraAdmisionFormateada: horaAdmision,
        HoraEgresoFormateada: horaEgreso
      };
    });

    // Seleccionar el primer registro válido de cada tipo (no futuro)
    const fechaActual = new Date();
    const fechaLimiteArgentina = new Date(fechaActual.getFullYear() + 1, fechaActual.getMonth(), fechaActual.getDate());
    
    const tiposMovimiento = ['Ingreso', 'Egreso', 'Movimiento de cama'];
    const resultadoFinal = [];
    
    tiposMovimiento.forEach(tipo => {
      const registrosDeTipo = resultadoConFechas.filter(row => row.TipoMovimiento === tipo);
      
      // Buscar el primer registro válido (no futuro) de este tipo
      for (const row of registrosDeTipo) {
        const fechaAdmision = row.FechaAdmisionFormateada ? new Date(row.FechaAdmisionFormateada) : null;
        const fechaEgreso = row.FechaEgresoFormateada ? new Date(row.FechaEgresoFormateada) : null;
        
        let esValido = true;
        
        // Validar que las fechas no sean futuras
        if (fechaAdmision && fechaAdmision > fechaLimiteArgentina) {
          console.warn(`Registro saltado por fecha de admisión futura: ${row.ApellidoyNombre} - ${fechaAdmision.toISOString()}`);
          esValido = false;
        }
        
        if (fechaEgreso && fechaEgreso > fechaLimiteArgentina) {
          console.warn(`Registro saltado por fecha de egreso futura: ${row.ApellidoyNombre} - ${fechaEgreso.toISOString()}`);
          esValido = false;
        }
        
        if (esValido) {
          resultadoFinal.push(row);
          break; // Solo tomar el primer registro válido de cada tipo
        }
      }
    });
    
    // Ordenar por fecha más reciente
    resultadoFinal.sort((a, b) => {
      const fechaA = a.TipoMovimiento === 'Egreso' && a.FechaEgresoFormateada 
        ? new Date(a.FechaEgresoFormateada) 
        : new Date(a.FechaAdmisionFormateada || 0);
      const fechaB = b.TipoMovimiento === 'Egreso' && b.FechaEgresoFormateada 
        ? new Date(b.FechaEgresoFormateada) 
        : new Date(b.FechaAdmisionFormateada || 0);
      
      return fechaB.getTime() - fechaA.getTime(); // Más reciente primero
    });
    
    return resultadoFinal || [];
  } catch (error) {
    console.error('Error al obtener movimientos recientes:', error);
    throw new Error('Error al obtener los movimientos recientes de internación');
  }
}


module.exports = {
  obtenerUltimoMovimientoVisita,
  actualizarUltimoMovimientoVisita,
  obtenerMovimientosVisita,
  moverPacienteACamaVacia,
  intercambiarCamasPacientes,
  obtenerMovimientosRecientes
};
