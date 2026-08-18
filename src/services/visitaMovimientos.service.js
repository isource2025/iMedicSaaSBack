/**
 * Servicio para gestión de movimientos de visitas
 * @module services/visitaMovimientos.service
 */
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion, convertirFechaClarionADate, convertirHoraClarionAString, clarionAIsoCalendario } = require('../utils/dateUtils');

function clarionInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function visitaYaEgresada(fechaEgreso) {
  return clarionInt(fechaEgreso) > 0;
}

/** Si llega "SECTOR-CAMA", devuelve solo el código de cama. */
function codigoCama(bedId, sector, fallback) {
  const raw = String(bedId || '').trim();
  const sec = String(sector || '').trim();
  const fb = String(fallback || '').trim();
  if (!raw) return fb;
  if (sec) {
    const prefix = `${sec}-`;
    if (raw.length > prefix.length && raw.slice(0, prefix.length).toUpperCase() === prefix.toUpperCase()) {
      return raw.slice(prefix.length);
    }
  }
  return raw;
}

async function obtenerCabeceraVisita(numeroVisita) {
  const rows = await executeQuery(
    `
      SELECT
        IDPaciente,
        FechaAdmisionS,
        LTRIM(RTRIM(ISNULL(ServicioHospital, ''))) AS ServicioHospital,
        LTRIM(RTRIM(ISNULL(Diagnostico, ''))) AS Diagnostico,
        LTRIM(RTRIM(ISNULL(EstadoAmbulatorio, ''))) AS EstadoAmbulatorio,
        ISNULL(TRY_CAST(FECHAEGRESO AS int), 0) AS FechaEgreso
      FROM dbo.imVisita
      WHERE NumeroVisita = @p0
    `,
    [{ value: numeroVisita }],
  );
  return rows[0] || null;
}

/**
 * Obtiene el último movimiento de una visita
 */
async function obtenerUltimoMovimientoVisita(numeroVisita) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error(`Visita inválida: ${numeroVisita}`);

  const sql = `
    SELECT TOP 1
      NumeroVisita, FechaAdmision, HoraAdmision,
      FechaEgreso, HoraEgreso, DisposicionEgreso, Diagnostico,
      LTRIM(RTRIM(ISNULL(ValorHabitacionCama, ''))) AS ValorHabitacionCama,
      LTRIM(RTRIM(ISNULL(ValorSector, ''))) AS ValorSector,
      LTRIM(RTRIM(ISNULL(ValorHabitacionCama, ''))) AS bedId,
      LTRIM(RTRIM(ISNULL(EstadoAmbulatorio, ''))) AS EstadoAmbulatorio,
      LTRIM(RTRIM(ISNULL(ServicioHospital, ''))) AS ServicioHospital
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

function _hhmmClarion(horaClarion) {
  const s = convertirHoraClarionAString(horaClarion);
  return s ? s.slice(0, 5) : null;
}

function _mapMovimientoIso(row) {
  if (!row) return row;
  return {
    ...row,
    FechaAdmisionISO: clarionAIsoCalendario(row.FechaAdmision) || null,
    FechaEgresoISO: clarionAIsoCalendario(row.FechaEgreso) || null,
    FechaCargaISO: clarionAIsoCalendario(row.FechaCarga) || null,
    HoraAdmisionISO: _hhmmClarion(row.HoraAdmision),
    HoraEgresoISO: _hhmmClarion(row.HoraEgreso),
    HoraCargaISO: _hhmmClarion(row.HoraCarga),
  };
}

const SQL_MOVIMIENTO_SELECT = `
      m.NumeroVisita,
      m.FechaAdmision,
      m.HoraAdmision,
      m.FechaEgreso,
      m.HoraEgreso,
      m.DisposicionEgreso,
      m.Diagnostico,
      m.ValorHabitacionCama,
      m.ValorSector,
      m.ServicioHospital,
      LTRIM(RTRIM(ISNULL(m.Operador, ''))) AS Operador,
      NULLIF(LTRIM(RTRIM(ISNULL(op.OperadorNombre, ''))), '') AS OperadorNombre,
      m.FechaCarga,
      m.HoraCarga,
      LTRIM(RTRIM(ISNULL(sm.Descripcion, m.ServicioHospital))) AS NombreServicio,
      LTRIM(RTRIM(ISNULL(m.ValorHabitacionCama, ''))) AS NombreCama,
      LTRIM(RTRIM(ISNULL(s.Descripcion, m.ValorSector))) AS NombreSector,
      NULLIF(LTRIM(RTRIM(ISNULL(d.Descripcion, ''))), '') AS DiagnosticoDescripcion,
      CONVERT(varchar(10), DATEADD(day, NULLIF(m.FechaAdmision,0), '1800-12-28'), 23) AS FechaAdmisionISO,
      CONVERT(varchar(5), DATEADD(ms, (NULLIF(m.HoraAdmision,0)-1)*10, 0), 108) AS HoraAdmisionISO,
      CONVERT(varchar(10), DATEADD(day, NULLIF(m.FechaEgreso,0),  '1800-12-28'), 23) AS FechaEgresoISO,
      CONVERT(varchar(5), DATEADD(ms, (NULLIF(m.HoraEgreso,0)-1)*10, 0), 108)  AS HoraEgresoISO,
      CONVERT(varchar(10), DATEADD(day, NULLIF(m.FechaCarga,0), '1800-12-28'), 23) AS FechaCargaISO,
      CONVERT(varchar(5), DATEADD(ms, (NULLIF(m.HoraCarga,0)-1)*10, 0), 108) AS HoraCargaISO
`;

const SQL_MOVIMIENTO_JOINS = `
    LEFT JOIN dbo.imSectores s ON s.Valor = LTRIM(RTRIM(m.ValorSector))
    LEFT JOIN dbo.imServiciosMedicos sm ON LTRIM(RTRIM(ISNULL(m.ServicioHospital, ''))) = LTRIM(RTRIM(ISNULL(sm.Valor, '')))
    OUTER APPLY (
      SELECT TOP 1 LTRIM(RTRIM(dx.Descripcion)) AS Descripcion
      FROM dbo.imDiagnosticos dx
      WHERE LTRIM(RTRIM(ISNULL(dx.CodigoOMS, ''))) = LTRIM(RTRIM(ISNULL(m.Diagnostico, '')))
      ORDER BY dx.Valor
    ) d
    OUTER APPLY (
      SELECT TOP 1 n.Nombre AS OperadorNombre
      FROM (
        SELECT
          COALESCE(
            NULLIF(LTRIM(RTRIM(
              CONCAT(
                NULLIF(LTRIM(RTRIM(ISNULL(pw.Apellido, ''))), ''),
                CASE
                  WHEN NULLIF(LTRIM(RTRIM(ISNULL(pw.Apellido, ''))), '') IS NOT NULL
                       AND NULLIF(LTRIM(RTRIM(ISNULL(pw.Nombres, ''))), '') IS NOT NULL
                  THEN ', '
                  ELSE ''
                END,
                NULLIF(LTRIM(RTRIM(ISNULL(pw.Nombres, ''))), '')
              )
            )), ''),
            NULLIF(LTRIM(RTRIM(ISNULL(pw.NombreRed, ''))), '')
          ) AS Nombre,
          0 AS Ord
        FROM dbo.imPassword pw
        WHERE TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int) IS NOT NULL
          AND (
            pw.CodOperador = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
            OR pw.ValorPersonal = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
          )
        UNION ALL
        SELECT LTRIM(RTRIM(ISNULL(p.ApellidoNombre, ''))), 1
        FROM dbo.imPersonal p
        WHERE TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int) IS NOT NULL
          AND (
            p.Valor = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
            OR p.Matricula = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
          )
      ) n
      WHERE NULLIF(LTRIM(RTRIM(n.Nombre)), '') IS NOT NULL
      ORDER BY n.Ord
    ) op
`;

async function queryMovimientosPorNumero(num) {
  const rows = await executeQuery(
    `
    SELECT ${SQL_MOVIMIENTO_SELECT}
    FROM dbo.imVisitaMovimiento m
    ${SQL_MOVIMIENTO_JOINS}
    WHERE m.NumeroVisita = @p0
    ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC
    `,
    [{ value: num }],
  );
  return rows || [];
}

/** Alta inicial en imVisita (cama/sector) cuando no hubo insert en imVisitaMovimiento. */
async function queryMovimientoInicialDesdeCabecera(num) {
  const rows = await executeQuery(
    `
    SELECT ${SQL_MOVIMIENTO_SELECT}
    FROM (
      SELECT
        v.NumeroVisita,
        CASE
          WHEN v.FECHAADMISIONS IS NULL THEN 0
          ELSE DATEDIFF(day, '1800-12-28', CAST(v.FECHAADMISIONS AS date))
        END AS FechaAdmision,
        CASE
          WHEN v.FECHAADMISIONS IS NULL THEN 0
          ELSE (DATEDIFF(millisecond, CAST(CAST(v.FECHAADMISIONS AS date) AS datetime), v.FECHAADMISIONS) / 10) + 1
        END AS HoraAdmision,
        ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) AS FechaEgreso,
        ISNULL(TRY_CAST(v.HoraEgreso AS int), 0) AS HoraEgreso,
        v.DisposicionEgreso,
        COALESCE(
          NULLIF(LTRIM(RTRIM(ISNULL(v.DiagnosticoEgreso, ''))), ''),
          LTRIM(RTRIM(ISNULL(v.Diagnostico, '')))
        ) AS Diagnostico,
        LTRIM(RTRIM(ISNULL(v.VALORHABITACIONCAMA, ''))) AS ValorHabitacionCama,
        LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) AS ValorSector,
        v.ServicioHospital,
        LTRIM(RTRIM(ISNULL(v.OPERADOR, ''))) AS Operador,
        ISNULL(TRY_CAST(v.FechaCarga AS int), 0) AS FechaCarga,
        ISNULL(TRY_CAST(v.HoraCarga AS int), 0) AS HoraCarga
      FROM dbo.imVisita v
      WHERE v.NumeroVisita = @p0
        AND (
          LTRIM(RTRIM(ISNULL(v.VALORHABITACIONCAMA, ''))) <> ''
          OR LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) <> ''
        )
    ) m
    ${SQL_MOVIMIENTO_JOINS}
    `,
    [{ value: num }],
  );
  return rows || [];
}

async function idsAlternativosMovimiento(num) {
  const rows = await executeQuery(
    `
      SELECT TRY_CAST(NULLIF(LTRIM(RTRIM(ISNULL(NUMEROINTERNACION, ''))), '') AS int) AS ni
      FROM dbo.imVisita
      WHERE NumeroVisita = @p0
    `,
    [{ value: num }],
  );
  const ni = Number(rows?.[0]?.ni);
  if (!Number.isFinite(ni) || ni <= 0 || ni === num) return [];
  const otraVisita = await executeQuery(
    `SELECT TOP 1 NumeroVisita FROM dbo.imVisita WHERE NumeroVisita = @p0`,
    [{ value: ni }],
  );
  if (otraVisita?.length) return [];
  return [ni];
}

/**
 * Obtiene todos los movimientos de una visita.
 * Si no hay pases en imVisitaMovimiento, muestra el alta inicial de imVisita.
 */
async function obtenerMovimientosVisita(numeroVisita) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error(`Visita inválida: ${numeroVisita}`);

  let rows = await queryMovimientosPorNumero(num);
  if (!rows.length) {
    const alts = await idsAlternativosMovimiento(num);
    for (const alt of alts) {
      rows = await queryMovimientosPorNumero(alt);
      if (rows.length) break;
    }
  }
  if (!rows.length) {
    rows = await queryMovimientoInicialDesdeCabecera(num);
  }
  return rows.map(_mapMovimientoIso);
}

async function camasOcupadasPorVisita(numeroVisita) {
  return executeQuery(
    `
      SELECT
        LTRIM(RTRIM(ISNULL(ValorHabitacionCama, ''))) AS ValorHabitacionCama,
        LTRIM(RTRIM(ISNULL(ValorSector, ''))) AS ValorSector
      FROM dbo.imHabitacionCamas
      WHERE NumeroVisita = @p0 AND ISNULL(NumeroVisita, 0) <> 0
    `,
    [{ value: numeroVisita }],
  );
}

async function actualizarUltimoMovimientoVisita(numeroVisita, datosEgreso) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error('Visita inválida');

  const { fechaEgreso, horaEgreso, disposicionEgreso, diagnostico, bedId } = datosEgreso;

  if (!fechaEgreso || !horaEgreso) {
    throw new Error('Faltan datos obligatorios: fecha y hora de egreso');
  }

  const codOpRaw = datosEgreso.codOperador ?? datosEgreso.operadorEgreso ?? datosEgreso.OperadorEgreso;
  const codOperador = Number(codOpRaw);
  if (!Number.isFinite(codOperador) || codOperador <= 0) {
    throw new Error('Falta CodOperador de sesión para registrar el egreso');
  }

  const cDate = convertirFechaAClarion(fechaEgreso);
  const cTime = convertirHoraAClarion(horaEgreso);
  if (cDate == null || cTime == null) {
    throw new Error('Fecha u hora de egreso inválida');
  }
  const disposicion = Number.isFinite(Number(disposicionEgreso)) ? Number(disposicionEgreso) : 0;
  const diagRaw = String(diagnostico || '').trim().slice(0, 8);

  const ultimo = await obtenerUltimoMovimientoVisita(num);
  if (!ultimo) {
    throw new Error(`No se encontró el movimiento actual de la visita ${num}`);
  }
  const cabecera = await obtenerCabeceraVisita(num);
  if (!cabecera) {
    throw new Error(`No se encontró la visita ${num}`);
  }

  const sectorActual = String(ultimo.ValorSector || '').trim();
  const camaActual = codigoCama(bedId, sectorActual, ultimo.ValorHabitacionCama || ultimo.bedId);

  const pool = await getRequestPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Solo el movimiento ACTUAL (último ingreso). Los pases de cama ya cerraron el anterior.
    const reqMov = new sql.Request(tx);
    reqMov.input('nv', sql.Int, num);
    reqMov.input('feg', sql.Int, cDate);
    reqMov.input('heg', sql.Int, cTime);
    reqMov.input('disp', sql.Int, disposicion);
    reqMov.input('diag', sql.VarChar(8), diagRaw);
    const movRes = await reqMov.query(`
      ;WITH actual AS (
        SELECT TOP 1 NumeroVisita, FechaAdmision, HoraAdmision
        FROM dbo.imVisitaMovimiento
        WHERE NumeroVisita = @nv
        ORDER BY FechaAdmision DESC, HoraAdmision DESC
      )
      UPDATE m
      SET
        FechaEgreso = @feg,
        HoraEgreso = @heg,
        DisposicionEgreso = CASE WHEN @disp = 0 THEN m.DisposicionEgreso ELSE @disp END,
        Diagnostico = CASE WHEN LTRIM(RTRIM(@diag)) = '' THEN m.Diagnostico ELSE @diag END
      FROM dbo.imVisitaMovimiento m
      INNER JOIN actual a
        ON m.NumeroVisita = a.NumeroVisita
       AND m.FechaAdmision = a.FechaAdmision
       AND m.HoraAdmision = a.HoraAdmision
    `);
    if (!movRes?.rowsAffected?.[0]) {
      throw new Error('No se pudo actualizar el movimiento actual de cama');
    }

    // Libera solo la cama de la ubicación actual (la que todavía tiene esta visita)
    const reqCama = new sql.Request(tx);
    reqCama.input('nv', sql.Int, num);
    reqCama.input('feg', sql.Int, cDate);
    reqCama.input('cama', sql.VarChar(20), camaActual || '');
    reqCama.input('sec', sql.VarChar(20), sectorActual || '');
    await reqCama.query(`
      UPDATE dbo.imHabitacionCamas
      SET
        FechaIngreso = 0,
        FechaEgreso = @feg,
        ValorEstadoCama = 'U',
        NumeroVisita = 0,
        Observaciones = 'Egreso'
      WHERE TRY_CAST(NumeroVisita AS int) = @nv
        AND (
          LTRIM(RTRIM(@cama)) = ''
          OR LTRIM(RTRIM(@sec)) = ''
          OR (
            LTRIM(RTRIM(ValorHabitacionCama)) = LTRIM(RTRIM(@cama))
            AND LTRIM(RTRIM(ValorSector)) = LTRIM(RTRIM(@sec))
          )
        )
    `);

    const reqVis = new sql.Request(tx);
    reqVis.input('nv', sql.Int, num);
    reqVis.input('feg', sql.Int, cDate);
    reqVis.input('heg', sql.Int, cTime);
    reqVis.input('disp', sql.Int, disposicion);
    reqVis.input('diag', sql.VarChar(8), diagRaw);
    reqVis.input('op', sql.VarChar(20), String(codOperador));
    await reqVis.query(`
      UPDATE dbo.imVisita
      SET
        FechaEgreso = @feg,
        HoraEgreso = @heg,
        DisposicionEgreso = CASE WHEN @disp = 0 THEN DisposicionEgreso ELSE @disp END,
        DiagnosticoEgreso = CASE
          WHEN LTRIM(RTRIM(@diag)) = '' THEN DiagnosticoEgreso
          ELSE @diag
        END,
        OperadorEgreso = @op
      WHERE NumeroVisita = @nv
    `);

    const chk = new sql.Request(tx);
    chk.input('nv', sql.Int, num);
    const chkRes = await chk.query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.imHabitacionCamas WHERE TRY_CAST(NumeroVisita AS int) = @nv) AS Camas,
        (
          SELECT TOP 1 ISNULL(TRY_CAST(FechaEgreso AS int), 0)
          FROM dbo.imVisitaMovimiento
          WHERE NumeroVisita = @nv
          ORDER BY FechaAdmision DESC, HoraAdmision DESC
        ) AS FechaEgresoActual
    `);
    const leftover = chkRes.recordset?.[0] || {};
    if (Number(leftover.Camas) > 0) {
      throw new Error(`No se pudo liberar la cama actual de la visita ${num}`);
    }
    if (clarionInt(leftover.FechaEgresoActual) <= 0) {
      throw new Error('El movimiento actual de cama sigue abierto después del egreso');
    }

    await tx.commit();

    const ultimoTras = await obtenerUltimoMovimientoVisita(num);
    return {
      success: true,
      message: 'Egreso registrado',
      data: ultimoTras,
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {
      /* transacción ya abortada */
    }
    console.error('Error en transacción de egreso:', err);
    const detail = err && (err.originalError?.info?.message || err.message);
    throw new Error(detail || 'Error al actualizar el último movimiento de la visita');
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

  const {
    FechaAdmision,
    HoraAdmision,
    FechaEgreso,
    HoraEgreso,
    EstadoAmbulatorio,
    Diagnostico,
    bedId,
    ValorSector,
    Operador,
    FechaCarga,
    HoraCarga,
  } = datos;

  if (!FechaAdmision || !HoraAdmision || !FechaEgreso || !HoraEgreso ||
      !bedId || !ValorSector || !Operador || !FechaCarga || !HoraCarga) {
    throw new Error('Faltan datos obligatorios para el movimiento de cama. Se requiere: FechaAdmision, HoraAdmision, FechaEgreso, HoraEgreso, bedId, ValorSector, Operador, FechaCarga, HoraCarga');
  }

  const ultimoMovimiento = await obtenerUltimoMovimientoVisita(num);
  if (!ultimoMovimiento) {
    throw new Error(`No se encontró el último movimiento para la visita ${num}`);
  }
  if (visitaYaEgresada(ultimoMovimiento.FechaEgreso)) {
    throw new Error(`La visita ${num} ya tiene egreso; no se puede trasladar`);
  }

  const cabecera = await obtenerCabeceraVisita(num);
  if (!cabecera) {
    throw new Error(`No se encontró información del paciente para la visita ${num}`);
  }
  if (visitaYaEgresada(cabecera.FechaEgreso)) {
    throw new Error(`La visita ${num} ya tiene egreso hospitalario; no se puede trasladar`);
  }

  const estadoEnviado = String(EstadoAmbulatorio || '').trim();
  const diagnosticoEnviado = String(Diagnostico || '').trim();
  const estadoAmbMovimiento =
    estadoEnviado ||
    String(ultimoMovimiento.EstadoAmbulatorio || '').trim() ||
    String(cabecera.EstadoAmbulatorio || '').trim() ||
    ' ';
  const diagnosticoMovimiento =
    diagnosticoEnviado ||
    String(ultimoMovimiento.Diagnostico || '').trim() ||
    String(cabecera.Diagnostico || '').trim() ||
    null;
  const servicioHospital =
    String(ultimoMovimiento.ServicioHospital || '').trim() ||
    String(cabecera.ServicioHospital || '').trim() ||
    null;

  const camaActualResult = await executeQuery(
    `
      SELECT ValorHabitacionCama, ValorSector
      FROM imHabitacionCamas
      WHERE NumeroVisita = @param0
    `,
    [{ value: num }],
  );
  if (!camaActualResult || camaActualResult.length === 0) {
    throw new Error(`No se encontró la cama actual para la visita ${num}`);
  }

  const sectorPreferido = String(ultimoMovimiento.ValorSector || '').trim();
  const camaPreferida = camaActualResult.find(
    (r) => String(r.ValorSector || '').trim() === sectorPreferido,
  );
  const camaOrigen = camaPreferida || camaActualResult[0];
  const camaActual = String(camaOrigen.ValorHabitacionCama || '').trim();
  const sectorActual = String(camaOrigen.ValorSector || '').trim();
  const sectorDestino = String(ValorSector || '').trim();
  const camaDestino = codigoCama(bedId, sectorDestino, bedId);

  const camaDestinoResult = await executeQuery(
    `
      SELECT c.ValorHabitacionCama, c.ValorSector, c.ValorEstadoCama, e.Descripcion as EstadoDescripcion
      FROM imHabitacionCamas c
      LEFT JOIN imEstadoCama e ON c.ValorEstadoCama = e.Valor
      WHERE c.ValorHabitacionCama = @param0 AND c.ValorSector = @param1
    `,
    [{ value: camaDestino }, { value: sectorDestino }],
  );

  if (!camaDestinoResult || camaDestinoResult.length === 0) {
    throw new Error(`La cama destino ${camaDestino} en el sector ${sectorDestino} no existe`);
  }

  const estadoCama = camaDestinoResult[0].ValorEstadoCama;
  if (estadoCama !== 'U') {
    throw new Error(`La cama destino ${camaDestino} en el sector ${sectorDestino} no está disponible. Estado actual: ${camaDestinoResult[0].EstadoDescripcion || estadoCama}`);
  }


  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;

      -- 1. Egreso de la cama origen (no pisar diagnóstico/estado del tramo cerrado)
      UPDATE imVisitaMovimiento
      SET
        FechaEgreso = @param0,
        HoraEgreso = @param1,
        Operador = @param4
      WHERE
        NumeroVisita = @param5 AND
        FechaAdmision = @param6 AND
        HoraAdmision = @param7;

      -- 2. Liberar cama origen (deja FechaEgreso del traslado)
      UPDATE imHabitacionCamas
      SET
        FechaIngreso = 0,
        FechaEgreso = @param0,
        ValorEstadoCama = 'U',
        NumeroVisita = 0,
        Observaciones = 'Traslado a cama ' + @param13
      WHERE NumeroVisita = @param5
         OR (
           ValorHabitacionCama = @param8
           AND ValorSector = @param15
         );

      -- 3. Alta en la cama destino
      IF NOT EXISTS (
        SELECT 1 FROM imVisitaMovimiento
        WHERE NumeroVisita = @param5 AND FechaAdmision = @param9 AND HoraAdmision = @param10
      )
      BEGIN
        INSERT INTO imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision,
          FechaEgreso, HoraEgreso,
          EstadoAmbulatorio, Diagnostico, Operador,
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
          ServicioHospital, [Status]
        )
        VALUES (
          @param5, @param9, @param10,
          0, 0,
          @param2, @param3, @param4,
          @param11, @param12, @param14, @param13, 'O',
          @param16, 0
        );
      END
      ELSE
      BEGIN
        DECLARE @NuevaHoraAdmision int = @param10 + 1;
        INSERT INTO imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision,
          FechaEgreso, HoraEgreso,
          EstadoAmbulatorio, Diagnostico, Operador,
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
          ServicioHospital, [Status]
        )
        VALUES (
          @param5, @param9, @NuevaHoraAdmision,
          0, 0,
          @param2, @param3, @param4,
          @param11, @param12, @param14, @param13, 'O',
          @param16, 0
        );
      END;

      -- 4. Ocupar cama destino
      UPDATE imHabitacionCamas
      SET
        FechaIngreso = @param9,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param5,
        Observaciones = 'Traslado desde cama ' + @param8
      WHERE ValorHabitacionCama = @param13
        AND ValorSector = @param14;

      -- 5. Ubicación actual (internación sigue abierta; no pisar Operador de admisión)
      UPDATE imVisita
      SET
        FechaEgreso = 0,
        HoraEgreso = 0,
        ValorHabitacionCama = @param13,
        ValorSector = @param14,
        EstadoAmbulatorio = CASE
          WHEN @param17 = 1 THEN @param2 ELSE EstadoAmbulatorio
        END,
        Diagnostico = CASE
          WHEN @param18 = 1 THEN @param3 ELSE Diagnostico
        END
      WHERE NumeroVisita = @param5;

      COMMIT;
    END TRY
    BEGIN CATCH
      ROLLBACK;
      THROW;
    END CATCH;
  `;

  const params = [
    { value: FechaEgreso },
    { value: HoraEgreso },
    { value: estadoAmbMovimiento },
    { value: diagnosticoMovimiento },
    { value: String(Operador) },
    { value: num },
    { value: ultimoMovimiento.FechaAdmision },
    { value: ultimoMovimiento.HoraAdmision },
    { value: camaActual },
    { value: FechaAdmision },
    { value: HoraAdmision },
    { value: FechaCarga },
    { value: HoraCarga },
    { value: camaDestino },
    { value: sectorDestino },
    { value: sectorActual },
    { value: servicioHospital },
    { value: estadoEnviado ? 1 : 0 },
    { value: diagnosticoEnviado ? 1 : 0 },
  ];

  try {
    await executeQuery(query, params);

    const nuevoMovimiento = await obtenerUltimoMovimientoVisita(num);

    return {
      success: true,
      message: 'Paciente trasladado exitosamente a la nueva cama',
      data: {
        numeroVisita: num,
        camaAnterior: camaActual,
        camaNueva: camaDestino,
        movimiento: nuevoMovimiento,
      },
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
      !Operador || !FechaCarga || !HoraCarga) {
    throw new Error('Faltan datos obligatorios para el intercambio de camas');
  }

  // Obtener información del último movimiento para ambos pacientes
  const ultimoMovimiento1 = await obtenerUltimoMovimientoVisita(num1);
  const ultimoMovimiento2 = await obtenerUltimoMovimientoVisita(num2);
  
  if (!ultimoMovimiento1 || !ultimoMovimiento2) {
    throw new Error(`No se encontró el último movimiento para alguna de las visitas`);
  }
  if (visitaYaEgresada(ultimoMovimiento1.FechaEgreso) || visitaYaEgresada(ultimoMovimiento2.FechaEgreso)) {
    throw new Error('No se puede intercambiar: alguna de las visitas ya tiene egreso');
  }

  const cab1 = await obtenerCabeceraVisita(num1);
  const cab2 = await obtenerCabeceraVisita(num2);
  if (!cab1 || !cab2) {
    throw new Error('No se encontró una de las visitas');
  }
  if (visitaYaEgresada(cab1.FechaEgreso) || visitaYaEgresada(cab2.FechaEgreso)) {
    throw new Error('No se puede intercambiar: alguna de las visitas ya tiene egreso hospitalario');
  }

  const estado1 =
    String(ultimoMovimiento1.EstadoAmbulatorio || '').trim() ||
    String(cab1.EstadoAmbulatorio || '').trim() ||
    ' ';
  const estado2 =
    String(ultimoMovimiento2.EstadoAmbulatorio || '').trim() ||
    String(cab2.EstadoAmbulatorio || '').trim() ||
    ' ';
  const diagnostico1 =
    String(ultimoMovimiento1.Diagnostico || '').trim() ||
    String(cab1.Diagnostico || '').trim() ||
    null;
  const diagnostico2 =
    String(ultimoMovimiento2.Diagnostico || '').trim() ||
    String(cab2.Diagnostico || '').trim() ||
    null;
  const servicio1 =
    String(ultimoMovimiento1.ServicioHospital || '').trim() ||
    String(cab1.ServicioHospital || '').trim() ||
    null;
  const servicio2 =
    String(ultimoMovimiento2.ServicioHospital || '').trim() ||
    String(cab2.ServicioHospital || '').trim() ||
    null;

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
  
  const paciente1 = camasResult.find(c => parseInt(c.NumeroVisita) === num1);
  const paciente2 = camasResult.find(c => parseInt(c.NumeroVisita) === num2);
  
  if (!paciente1 || !paciente2) {
    throw new Error('No se pudo identificar correctamente a los pacientes');
  }
  
  const cama1 = paciente1.ValorHabitacionCama;
  const sector1 = paciente1.ValorSector;
  const cama2 = paciente2.ValorHabitacionCama;
  const sector2 = paciente2.ValorSector;
  
  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;

      UPDATE imVisitaMovimiento
      SET FechaEgreso = @param0, HoraEgreso = @param1, Operador = @param4
      WHERE NumeroVisita = @param5 AND FechaAdmision = @param6 AND HoraAdmision = @param7;

      UPDATE imVisitaMovimiento
      SET FechaEgreso = @param0, HoraEgreso = @param1, Operador = @param4
      WHERE NumeroVisita = @param8 AND FechaAdmision = @param9 AND HoraAdmision = @param10;

      UPDATE imHabitacionCamas
      SET NumeroVisita = 0, ValorEstadoCama = 'M'
      WHERE NumeroVisita IN (@param5, @param8)
         OR (ValorHabitacionCama = @param11 AND ValorSector = @param17)
         OR (ValorHabitacionCama = @param12 AND ValorSector = @param18);

      INSERT INTO imVisitaMovimiento (
        NumeroVisita, FechaAdmision, HoraAdmision,
        FechaEgreso, HoraEgreso,
        EstadoAmbulatorio, Diagnostico, Operador,
        FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
        ServicioHospital, [Status]
      )
      VALUES (
        @param5, @param13, @param14,
        0, 0,
        @param2, @param3, @param4,
        @param15, @param16, @param18, @param12, 'O',
        @param19, 0
      );

      INSERT INTO imVisitaMovimiento (
        NumeroVisita, FechaAdmision, HoraAdmision,
        FechaEgreso, HoraEgreso,
        EstadoAmbulatorio, Diagnostico, Operador,
        FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
        ServicioHospital, [Status]
      )
      VALUES (
        @param8, @param13, @param14,
        0, 0,
        @param20, @param21, @param4,
        @param15, @param16, @param17, @param11, 'O',
        @param22, 0
      );

      UPDATE imHabitacionCamas
      SET
        FechaIngreso = @param13,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param8,
        Observaciones = 'Intercambio desde cama ' + @param12
      WHERE ValorHabitacionCama = @param11 AND ValorSector = @param17;

      UPDATE imHabitacionCamas
      SET
        FechaIngreso = @param13,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param5,
        Observaciones = 'Intercambio desde cama ' + @param11
      WHERE ValorHabitacionCama = @param12 AND ValorSector = @param18;

      UPDATE imVisita
      SET
        FechaEgreso = 0,
        HoraEgreso = 0,
        ValorHabitacionCama = @param12,
        ValorSector = @param18
      WHERE NumeroVisita = @param5;

      UPDATE imVisita
      SET
        FechaEgreso = 0,
        HoraEgreso = 0,
        ValorHabitacionCama = @param11,
        ValorSector = @param17
      WHERE NumeroVisita = @param8;

      COMMIT;
    END TRY
    BEGIN CATCH
      ROLLBACK;
      THROW;
    END CATCH;
  `;

  const params = [
    { value: FechaEgreso },
    { value: HoraEgreso },
    { value: estado1 },
    { value: diagnostico1 },
    { value: String(Operador) },
    { value: num1 },
    { value: ultimoMovimiento1.FechaAdmision },
    { value: ultimoMovimiento1.HoraAdmision },
    { value: num2 },
    { value: ultimoMovimiento2.FechaAdmision },
    { value: ultimoMovimiento2.HoraAdmision },
    { value: cama1 },
    { value: cama2 },
    { value: FechaAdmision },
    { value: HoraAdmision },
    { value: FechaCarga },
    { value: HoraCarga },
    { value: sector1 },
    { value: sector2 },
    { value: servicio1 },
    { value: estado2 },
    { value: diagnostico2 },
    { value: servicio2 },
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
        FechaAdmisionFormateada: clarionAIsoCalendario(row.FechaAdmision),
        FechaEgresoFormateada: clarionAIsoCalendario(row.FechaEgreso),
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


/**
 * Pacientes internados (ClasePaciente = I) vigentes sin cama asignada en imHabitacionCamas.
 * Usa tablas existentes: imVisita, imPacientes, imHabitacionCamas, imDiagnosticos.
 * @param {string} [termino] - Nombre, documento o número de visita
 */
async function obtenerPacientesInternadosSinCama(termino = '') {
  const term = typeof termino === 'string' ? termino.trim() : '';
  const params = [];
  let filtroBusqueda = '';

  if (term) {
    const like = `%${term}%`;
    filtroBusqueda = `
      AND (
        p.ApellidoYNombre LIKE @p0
        OR CAST(p.NumeroDocumento AS varchar(40)) LIKE @p1
        OR CAST(v.NumeroVisita AS varchar(20)) LIKE @p2
        OR CAST(ISNULL(p.NumeroHC, '') AS varchar(40)) LIKE @p3
      )
    `;
    params.push({ value: like }, { value: like }, { value: like }, { value: like });
  }

  const sql = `
    SELECT TOP 50
      v.NumeroVisita AS numeroVisita,
      v.IDPaciente AS idPaciente,
      LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS apellidoYNombre,
      LTRIM(RTRIM(ISNULL(CAST(p.NumeroDocumento AS varchar(40)), ''))) AS numeroDocumento,
      LTRIM(RTRIM(ISNULL(CAST(p.NumeroHC AS varchar(40)), ''))) AS numeroHC,
      LTRIM(RTRIM(ISNULL(p.Sexo, ''))) AS sexo,
      CONVERT(varchar(10), v.FECHAADMISIONS, 23) AS fechaAdmision,
      CONVERT(varchar(5), v.FECHAADMISIONS, 108) AS horaAdmision,
      LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) AS valorSector,
      LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) AS diagnostico,
      LTRIM(RTRIM(ISNULL(d.Descripcion, ''))) AS diagnosticoDescripcion
    FROM dbo.imVisita v
    INNER JOIN dbo.imPacientes p ON p.IDPaciente = v.IDPaciente
    LEFT JOIN dbo.imDiagnosticos d
      ON LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) = LTRIM(RTRIM(ISNULL(d.CodigoOMS, '')))
    WHERE UPPER(LTRIM(RTRIM(COALESCE(v.ClasePaciente, '')))) = 'I'
      AND (
        v.FECHAEGRESO IS NULL
        OR TRY_CAST(v.FECHAEGRESO AS int) IS NULL
        OR TRY_CAST(v.FECHAEGRESO AS int) = 0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.imHabitacionCamas hc
        WHERE hc.NumeroVisita = v.NumeroVisita
          AND ISNULL(hc.NumeroVisita, 0) <> 0
      )
      ${filtroBusqueda}
    ORDER BY v.FECHAADMISIONS DESC, v.NumeroVisita DESC
  `;

  return await executeQuery(sql, params);
}

/**
 * Asigna por primera vez una cama libre a un internado sin ubicación.
 * Tablas: imVisitaMovimiento (insert), imHabitacionCamas (ocupar), imVisita (actualizar).
 */
async function asignarPacienteACama(numeroVisita, datos) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error('Número de visita inválido');

  const {
    FechaAdmision,
    HoraAdmision,
    ClasePaciente,
    EstadoAmbulatorio,
    Diagnostico,
    bedId,
    ValorSector,
    Operador,
    FechaCarga,
    HoraCarga,
  } = datos;

  const clasePaciente = String(ClasePaciente || '').trim();
  if (!FechaAdmision || !HoraAdmision || !clasePaciente || !bedId || !ValorSector || !Operador || !FechaCarga || !HoraCarga) {
    throw new Error('Faltan datos obligatorios para asignar la cama (incluye ClasePaciente)');
  }

  const visitaRows = await executeQuery(
    `
      SELECT
        IDPaciente,
        ClasePaciente,
        LTRIM(RTRIM(ISNULL(EstadoAmbulatorio, ''))) AS EstadoAmbulatorio,
        LTRIM(RTRIM(ISNULL(ServicioHospital, ''))) AS ServicioHospital,
        LTRIM(RTRIM(ISNULL(Diagnostico, ''))) AS Diagnostico,
        FECHAEGRESO,
        LTRIM(RTRIM(ISNULL(VALORHABITACIONCAMA, ''))) AS ValorHabitacionCama
      FROM dbo.imVisita
      WHERE NumeroVisita = @p0
    `,
    [{ value: num }],
  );

  if (!visitaRows?.length) {
    throw new Error(`No se encontró la visita ${num}`);
  }

  const visita = visitaRows[0];
  const fechaEgreso = Number(visita.FECHAEGRESO) || 0;
  if (fechaEgreso > 0) {
    throw new Error('La visita ya tiene egreso registrado');
  }

  const camaOcupada = await executeQuery(
    `
      SELECT TOP 1 ValorHabitacionCama, ValorSector
      FROM dbo.imHabitacionCamas
      WHERE NumeroVisita = @p0 AND ISNULL(NumeroVisita, 0) <> 0
    `,
    [{ value: num }],
  );
  if (camaOcupada?.length) {
    throw new Error(
      `La visita ya tiene cama asignada (${camaOcupada[0].ValorSector}-${camaOcupada[0].ValorHabitacionCama})`,
    );
  }

  const camaDestinoCodigo = codigoCama(bedId, ValorSector, bedId);

  const camaDestinoResult = await executeQuery(
    `
      SELECT c.ValorHabitacionCama, c.ValorSector, c.ValorEstadoCama, e.Descripcion AS EstadoDescripcion
      FROM dbo.imHabitacionCamas c
      LEFT JOIN dbo.imEstadoCama e ON c.ValorEstadoCama = e.Valor
      WHERE c.ValorHabitacionCama = @p0 AND c.ValorSector = @p1
    `,
    [{ value: camaDestinoCodigo }, { value: ValorSector }],
  );

  if (!camaDestinoResult?.length) {
    throw new Error(`La cama ${camaDestinoCodigo} en el sector ${ValorSector} no existe`);
  }
  if (camaDestinoResult[0].ValorEstadoCama !== 'U') {
    throw new Error(
      `La cama no está disponible. Estado: ${camaDestinoResult[0].EstadoDescripcion || camaDestinoResult[0].ValorEstadoCama}`,
    );
  }

  const estadoAmbMovimiento =
    String(EstadoAmbulatorio || '').trim() ||
    String(visita.EstadoAmbulatorio || '').trim() ||
    ' ';
  const servicioHospital = String(visita.ServicioHospital || '').trim() || null;

  const query = `
    BEGIN TRY
      BEGIN TRANSACTION;

      IF NOT EXISTS (
        SELECT 1 FROM dbo.imVisitaMovimiento
        WHERE NumeroVisita = @param0 AND FechaAdmision = @param1 AND HoraAdmision = @param2
      )
      BEGIN
        INSERT INTO dbo.imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision,
          FechaEgreso, HoraEgreso,
          EstadoAmbulatorio, Diagnostico, Operador,
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
          ServicioHospital, [Status]
        )
        VALUES (
          @param0, @param1, @param2,
          0, 0,
          @param3, @param4, @param5,
          @param6, @param7, @param8, @param9, 'O',
          @param11, 0
        );
      END
      ELSE
      BEGIN
        DECLARE @HoraAdj int = @param2 + 1;
        INSERT INTO dbo.imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision,
          FechaEgreso, HoraEgreso,
          EstadoAmbulatorio, Diagnostico, Operador,
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
          ServicioHospital, [Status]
        )
        VALUES (
          @param0, @param1, @HoraAdj,
          0, 0,
          @param3, @param4, @param5,
          @param6, @param7, @param8, @param9, 'O',
          @param11, 0
        );
      END;

      UPDATE dbo.imHabitacionCamas
      SET
        FechaIngreso = @param1,
        FechaEgreso = 0,
        ValorEstadoCama = 'O',
        NumeroVisita = @param0,
        Observaciones = 'Asignación inicial de cama'
      WHERE ValorHabitacionCama = @param9 AND ValorSector = @param8;

      UPDATE dbo.imVisita
      SET
        ValorHabitacionCama = @param9,
        ValorSector = @param8,
        ClasePaciente = @param10,
        Diagnostico = CASE
          WHEN @param4 IS NULL OR LTRIM(RTRIM(@param4)) = '' THEN Diagnostico
          ELSE @param4
        END
      WHERE NumeroVisita = @param0;

      COMMIT;
    END TRY
    BEGIN CATCH
      ROLLBACK;
      THROW;
    END CATCH;
  `;

  const params = [
    { value: num },
    { value: FechaAdmision },
    { value: HoraAdmision },
    { value: estadoAmbMovimiento },
    { value: Diagnostico || null },
    { value: String(Operador) },
    { value: FechaCarga },
    { value: HoraCarga },
    { value: ValorSector },
    { value: camaDestinoCodigo },
    { value: clasePaciente },
    { value: servicioHospital },
  ];

  try {
    await executeQuery(query, params);
    const movimiento = await obtenerUltimoMovimientoVisita(num);
    return {
      success: true,
      message: 'Cama asignada correctamente',
      data: {
        numeroVisita: num,
        cama: camaDestinoCodigo,
        sector: ValorSector,
        movimiento,
      },
    };
  } catch (err) {
    console.error('Error al asignar cama:', err);
    throw new Error(`Error al asignar la cama: ${err.message}`);
  }
}

module.exports = {
  obtenerUltimoMovimientoVisita,
  actualizarUltimoMovimientoVisita,
  obtenerMovimientosVisita,
  moverPacienteACamaVacia,
  intercambiarCamasPacientes,
  obtenerMovimientosRecientes,
  obtenerPacientesInternadosSinCama,
  asignarPacienteACama,
};
