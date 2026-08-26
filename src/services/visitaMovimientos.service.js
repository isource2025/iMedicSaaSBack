/**
 * Servicio para gestión de movimientos de visitas
 * @module services/visitaMovimientos.service
 */
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { convertirFechaAClarion, convertirHoraAClarion, convertirFechaClarionADate, convertirHoraClarionAString, clarionAIsoCalendario } = require('../utils/dateUtils');
const { normalizarFilas } = require('../utils/codigoSector');

function clarionInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function visitaYaEgresada(fechaEgreso) {
  return clarionInt(fechaEgreso) > 0;
}

/**
 * Los ingresos importados de otros sistemas traen fechas fuera de rango Clarion
 * (por ejemplo AAAAMMDD). Sin este tope, DATEADD desborda y cae toda la consulta.
 */
const CLARION_EPOCH = "'1800-12-28'";
const CLARION_FECHA_MAX = 400000;
const CLARION_HORA_MAX = 8640000;

function esFechaClarionValida(valor) {
  const n = clarionInt(valor);
  return n > 0 && n <= CLARION_FECHA_MAX;
}

function esHoraClarionValida(valor) {
  const n = clarionInt(valor);
  return n > 0 && n <= CLARION_HORA_MAX;
}

function sqlFechaClarionISO(columna) {
  return `CASE WHEN TRY_CAST(${columna} AS int) BETWEEN 1 AND ${CLARION_FECHA_MAX}
        THEN CONVERT(varchar(10), DATEADD(day, TRY_CAST(${columna} AS int), ${CLARION_EPOCH}), 23) END`;
}

function sqlHoraClarionISO(columna) {
  return `CASE WHEN TRY_CAST(${columna} AS int) BETWEEN 1 AND ${CLARION_HORA_MAX}
        THEN CONVERT(varchar(5), DATEADD(ms, (TRY_CAST(${columna} AS int) - 1) * 10, 0), 108) END`;
}

/** Error de regla de negocio: el controller lo devuelve como 409 con su mensaje. */
function errorNegocio(mensaje, statusCode = 409) {
  const e = new Error(mensaje);
  e.statusCode = statusCode;
  return e;
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
 * Los ingresos que entran automáticamente desde otro sistema quedan en imVisita y
 * en imHabitacionCamas pero sin ninguna fila en imVisitaMovimiento, así que no se
 * pueden trasladar ni egresar. Reconstruye ese movimiento de ingreso con la cama
 * que ya ocupa el paciente para que enfermería pueda operar la visita.
 *
 * @param {number} numeroVisita
 * @param {{fecha: number, hora: number}|null} limite - El ingreso reconstruido
 *   queda siempre antes de este momento (fecha/hora Clarion del traslado o egreso).
 */
async function asegurarMovimientoDeIngreso(numeroVisita, limite = null) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) throw new Error(`Visita inválida: ${numeroVisita}`);

  const existente = await obtenerUltimoMovimientoVisita(num);
  if (existente) return existente;

  const rows = await executeQuery(
    `
      SELECT TOP 1
        CASE
          WHEN v.FECHAADMISIONS IS NULL THEN 0
          ELSE DATEDIFF(day, ${CLARION_EPOCH}, CAST(v.FECHAADMISIONS AS date))
        END AS FechaAdmision,
        CASE
          WHEN v.FECHAADMISIONS IS NULL THEN 1
          ELSE (DATEDIFF(millisecond, CAST(CAST(v.FECHAADMISIONS AS date) AS datetime), v.FECHAADMISIONS) / 10) + 1
        END AS HoraAdmision,
        LTRIM(RTRIM(ISNULL(v.EstadoAmbulatorio, ''))) AS EstadoAmbulatorio,
        LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) AS Diagnostico,
        LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) AS ServicioHospital,
        NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(CAST(v.OPERADOR AS varchar(40)), ''))), ''), '0') AS Operador,
        LTRIM(RTRIM(COALESCE(hc.ValorSector, v.VALORSECTOR, ''))) AS ValorSector,
        LTRIM(RTRIM(COALESCE(hc.ValorHabitacionCama, v.VALORHABITACIONCAMA, ''))) AS ValorHabitacionCama,
        ISNULL(TRY_CAST(hc.FechaIngreso AS int), 0) AS FechaIngreso
      FROM dbo.imVisita v
      OUTER APPLY (
        SELECT TOP 1 ValorSector, ValorHabitacionCama, FechaIngreso
        FROM dbo.imHabitacionCamas
        WHERE NumeroVisita = v.NumeroVisita AND ISNULL(NumeroVisita, 0) <> 0
      ) hc
      WHERE v.NumeroVisita = @p0
    `,
    [{ value: num }],
  );

  const base = rows?.[0];
  if (!base) return null;

  const sector = String(base.ValorSector || '').trim();
  const cama = String(base.ValorHabitacionCama || '').trim();
  if (!sector && !cama) return null;

  let fecha = esFechaClarionValida(base.FechaAdmision)
    ? clarionInt(base.FechaAdmision)
    : clarionInt(base.FechaIngreso);
  if (!esFechaClarionValida(fecha)) return null;
  let hora = esHoraClarionValida(base.HoraAdmision) ? clarionInt(base.HoraAdmision) : 1;

  if (limite && esFechaClarionValida(limite.fecha)) {
    const fueraDeOrden =
      fecha > limite.fecha || (fecha === limite.fecha && hora >= clarionInt(limite.hora));
    if (fueraDeOrden) {
      fecha = clarionInt(limite.fecha);
      hora = Math.max(clarionInt(limite.hora) - 1, 1);
    }
  }

  await executeQuery(
    `
      IF NOT EXISTS (SELECT 1 FROM dbo.imVisitaMovimiento WHERE NumeroVisita = @p0)
      BEGIN
        INSERT INTO dbo.imVisitaMovimiento (
          NumeroVisita, FechaAdmision, HoraAdmision,
          FechaEgreso, HoraEgreso,
          EstadoAmbulatorio, Diagnostico, Operador,
          FechaCarga, HoraCarga, ValorSector, ValorHabitacionCama, EstadoCama,
          ServicioHospital, [Status]
        )
        VALUES (
          @p0, @p1, @p2,
          0, 0,
          @p3, @p4, @p5,
          DATEDIFF(day, ${CLARION_EPOCH}, CAST(GETDATE() AS date)),
          (DATEDIFF(millisecond, CAST(CAST(GETDATE() AS date) AS datetime), GETDATE()) / 10) + 1,
          @p6, @p7, 'O',
          @p8, 0
        );
      END
    `,
    [
      { value: num },
      { value: fecha },
      { value: hora },
      { value: String(base.EstadoAmbulatorio || '').trim() || ' ' },
      { value: String(base.Diagnostico || '').trim() || null },
      { value: String(base.Operador || '').trim() || '0' },
      { value: sector || null },
      { value: cama || null },
      { value: String(base.ServicioHospital || '').trim() || null },
    ],
  );

  console.log(
    `[movimientos] visita ${num}: se reconstruyó el movimiento de ingreso en ${sector}-${cama}`,
  );
  return obtenerUltimoMovimientoVisita(num);
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
  if (!esHoraClarionValida(horaClarion)) return null;
  const s = convertirHoraClarionAString(horaClarion);
  return s ? s.slice(0, 5) : null;
}

function _fechaIsoClarion(fechaClarion) {
  if (!esFechaClarionValida(fechaClarion)) return null;
  return clarionAIsoCalendario(fechaClarion) || null;
}

function _mapMovimientoIso(row) {
  if (!row) return row;
  return {
    ...row,
    FechaAdmisionISO: _fechaIsoClarion(row.FechaAdmision),
    FechaEgresoISO: _fechaIsoClarion(row.FechaEgreso),
    FechaCargaISO: _fechaIsoClarion(row.FechaCarga),
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
      NULLIF(LTRIM(RTRIM(ISNULL(disp.Descripcion, ''))), '') AS DisposicionEgresoDescripcion,
      ${sqlFechaClarionISO('m.FechaAdmision')} AS FechaAdmisionISO,
      ${sqlHoraClarionISO('m.HoraAdmision')} AS HoraAdmisionISO,
      ${sqlFechaClarionISO('m.FechaEgreso')} AS FechaEgresoISO,
      ${sqlHoraClarionISO('m.HoraEgreso')} AS HoraEgresoISO,
      ${sqlFechaClarionISO('m.FechaCarga')} AS FechaCargaISO,
      ${sqlHoraClarionISO('m.HoraCarga')} AS HoraCargaISO
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
      SELECT TOP 1 LTRIM(RTRIM(de.Descripcion)) AS Descripcion
      FROM dbo.imDisposicionEgreso de
      WHERE TRY_CAST(de.Valor AS int) > 0
        AND TRY_CAST(de.Valor AS int) = TRY_CAST(m.DisposicionEgreso AS int)
    ) disp
    OUTER APPLY (
      SELECT TOP 1 nom.OperadorNombre
      FROM (
        SELECT COALESCE(
          NULLIF(LTRIM(RTRIM(ISNULL(per.ApellidoNombre, ''))), ''),
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
          )), '')
        ) AS OperadorNombre,
        0 AS prio
        FROM dbo.imPassword pw
        LEFT JOIN dbo.imPersonal per ON per.Valor = pw.ValorPersonal
        WHERE LTRIM(RTRIM(ISNULL(m.Operador, ''))) <> ''
          AND LTRIM(RTRIM(ISNULL(m.Operador, ''))) <> '0'
          AND (
            LTRIM(RTRIM(CAST(pw.CodOperador AS varchar(40)))) = LTRIM(RTRIM(m.Operador))
            OR CAST(pw.ValorPersonal AS varchar(40)) = LTRIM(RTRIM(m.Operador))
            OR (
              TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int) IS NOT NULL
              AND (
                pw.ValorPersonal = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
                OR TRY_CAST(CAST(pw.CodOperador AS varchar(40)) AS int) = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
              )
            )
            OR LOWER(LTRIM(RTRIM(ISNULL(pw.NombreRed, '')))) = LOWER(LTRIM(RTRIM(m.Operador)))
          )
        UNION ALL
        SELECT LTRIM(RTRIM(per2.ApellidoNombre)) AS OperadorNombre, 1 AS prio
        FROM dbo.imPersonal per2
        WHERE LTRIM(RTRIM(ISNULL(m.Operador, ''))) <> ''
          AND LTRIM(RTRIM(ISNULL(m.Operador, ''))) <> '0'
          AND NULLIF(LTRIM(RTRIM(ISNULL(per2.ApellidoNombre, ''))), '') IS NOT NULL
          AND (
            CAST(per2.Valor AS varchar(40)) = LTRIM(RTRIM(m.Operador))
            OR CAST(ISNULL(per2.Matricula, 0) AS varchar(40)) = LTRIM(RTRIM(m.Operador))
            OR (
              TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int) IS NOT NULL
              AND (
                per2.Valor = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
                OR per2.Matricula = TRY_CAST(LTRIM(RTRIM(m.Operador)) AS int)
              )
            )
          )
      ) nom
      WHERE NULLIF(LTRIM(RTRIM(ISNULL(nom.OperadorNombre, ''))), '') IS NOT NULL
      ORDER BY nom.prio
    ) op
`;

async function queryMovimientosPorNumero(num) {
  const rows = await executeQuery(
    `
    SELECT ${SQL_MOVIMIENTO_SELECT}
    FROM (
      SELECT
        m.NumeroVisita,
        m.FechaAdmision,
        m.HoraAdmision,
        m.FechaEgreso,
        m.HoraEgreso,
        COALESCE(
          NULLIF(TRY_CAST(m.DisposicionEgreso AS int), 0),
          CASE
            WHEN ROW_NUMBER() OVER (ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC) = 1
            THEN NULLIF(TRY_CAST(v.DisposicionEgreso AS int), 0)
            ELSE NULL
          END,
          0
        ) AS DisposicionEgreso,
        CASE
          WHEN NULLIF(LTRIM(RTRIM(ISNULL(m.Diagnostico, ''))), '') IS NOT NULL
          THEN LTRIM(RTRIM(m.Diagnostico))
          WHEN ROW_NUMBER() OVER (ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC) = 1
          THEN COALESCE(
            NULLIF(LTRIM(RTRIM(ISNULL(v.DiagnosticoEgreso, ''))), ''),
            LTRIM(RTRIM(ISNULL(v.Diagnostico, '')))
          )
          ELSE ''
        END AS Diagnostico,
        m.ValorHabitacionCama,
        m.ValorSector,
        m.ServicioHospital,
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(CAST(m.Operador AS varchar(40)), ''))), ''), '0'),
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(CAST(v.OPERADOR AS varchar(40)), ''))), ''), '0'),
          CASE
            WHEN ROW_NUMBER() OVER (ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC) = 1
             AND ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) > 0
            THEN NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(CAST(v.OperadorEgreso AS varchar(40)), ''))), ''), '0')
            ELSE NULL
          END,
          ''
        ) AS Operador,
        m.FechaCarga,
        m.HoraCarga
      FROM dbo.imVisitaMovimiento m
      LEFT JOIN dbo.imVisita v ON v.NumeroVisita = m.NumeroVisita
      WHERE m.NumeroVisita = @p0
    ) m
    ${SQL_MOVIMIENTO_JOINS}
    ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC
    `,
    [{ value: num }],
  );
  return normalizarFilas(rows || []);
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
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(CAST(v.OPERADOR AS varchar(40)), ''))), ''), '0'),
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(CAST(v.OperadorEgreso AS varchar(40)), ''))), ''), '0'),
          ''
        ) AS Operador,
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
  return normalizarFilas(rows || []);
}

function _codigoOperadorRow(row) {
  const raw = String(row?.Operador ?? row?.operador ?? '').trim();
  if (!raw || raw === '0') return '';
  return raw;
}

function _nombreVisibleOperador(row) {
  const personal = String(row.PersonalNombre || row.ApellidoNombre || '').trim();
  if (personal) return personal;
  const ap = String(row.Apellido || '').trim();
  const no = String(row.Nombres || '').trim();
  if (ap && no) return `${ap}, ${no}`;
  if (ap || no) return ap || no;
  const red = String(row.NombreRed || '').trim();
  if (red && !/^\d+$/.test(red)) return red;
  return '';
}

/** Sarmiento/Clarion: CodOperador es texto; el nombre suele estar en imPersonal. */
async function completarNombresOperador(rows) {
  if (!rows?.length) return rows;
  const pendientes = rows.filter((r) => !String(r.OperadorNombre || r.operadorNombre || '').trim());
  if (!pendientes.length) return rows;

  const raws = [...new Set(pendientes.map((r) => _codigoOperadorRow(r)).filter(Boolean))];
  if (!raws.length) return rows;

  const params = [];
  const ph = (value, type) => {
    params.push({ value, type });
    return `@p${params.length - 1}`;
  };
  const strPh = raws.map((v) => ph(v, 'VarChar'));
  const nums = [...new Set(raws.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n !== 0))];
  const numPh = nums.map((n) => ph(n, 'Int'));

  let where = `LTRIM(RTRIM(CAST(pw.CodOperador AS varchar(40)))) IN (${strPh.join(',')})
    OR LOWER(LTRIM(RTRIM(ISNULL(pw.NombreRed, '')))) IN (${strPh.map((p) => `LOWER(${p})`).join(',')})`;
  if (numPh.length) {
    where += ` OR pw.ValorPersonal IN (${numPh.join(',')})
      OR TRY_CAST(LTRIM(RTRIM(CAST(pw.CodOperador AS varchar(40)))) AS int) IN (${numPh.join(',')})`;
  }

  let found = [];
  try {
    found = await executeQuery(
      `
      SELECT
        LTRIM(RTRIM(CAST(pw.CodOperador AS varchar(40)))) AS CodOperador,
        pw.ValorPersonal,
        LTRIM(RTRIM(ISNULL(pw.NombreRed, ''))) AS NombreRed,
        LTRIM(RTRIM(ISNULL(pw.Apellido, ''))) AS Apellido,
        LTRIM(RTRIM(ISNULL(pw.Nombres, ''))) AS Nombres,
        LTRIM(RTRIM(ISNULL(per.ApellidoNombre, ''))) AS PersonalNombre
      FROM dbo.imPassword pw
      LEFT JOIN dbo.imPersonal per ON per.Valor = pw.ValorPersonal
      WHERE ${where}
      `,
      params,
    );
  } catch (err) {
    console.warn('[movimientos] nombres operador (password):', err.message);
  }

  let personal = [];
  try {
    const pParams = [];
    const pPh = (value, type) => {
      pParams.push({ value, type });
      return `@p${pParams.length - 1}`;
    };
    const strIn = raws.map((v) => pPh(v, 'VarChar'));
    const numIn = nums.map((n) => pPh(n, 'Int'));
    let whereP = `CAST(Valor AS varchar(40)) IN (${strIn.join(',')})
      OR CAST(ISNULL(Matricula, 0) AS varchar(40)) IN (${strIn.join(',')})`;
    if (numIn.length) {
      whereP += ` OR Valor IN (${numIn.join(',')}) OR Matricula IN (${numIn.join(',')})`;
    }
    personal = await executeQuery(
      `
      SELECT Valor, Matricula, LTRIM(RTRIM(ISNULL(ApellidoNombre, ''))) AS ApellidoNombre
      FROM dbo.imPersonal
      WHERE ${whereP}
      `,
      pParams,
    );
  } catch (err) {
    console.warn('[movimientos] nombres operador (personal):', err.message);
  }

  const byKey = new Map();
  const put = (key, nombre) => {
    const k = String(key ?? '').trim().toLowerCase();
    if (!k || !nombre || byKey.has(k)) return;
    byKey.set(k, nombre);
  };
  for (const r of found || []) {
    const nom = _nombreVisibleOperador(r);
    if (!nom) continue;
    put(r.CodOperador, nom);
    put(r.ValorPersonal, nom);
    put(r.NombreRed, nom);
    const nCod = Number(r.CodOperador);
    if (Number.isFinite(nCod)) put(String(nCod), nom);
    const nVp = Number(r.ValorPersonal);
    if (Number.isFinite(nVp)) put(String(nVp), nom);
  }
  for (const r of personal || []) {
    const nom = String(r.ApellidoNombre || '').trim();
    if (!nom) continue;
    put(r.Valor, nom);
    put(r.Matricula, nom);
  }

  return rows.map((r) => {
    if (String(r.OperadorNombre || r.operadorNombre || '').trim()) return r;
    const op = _codigoOperadorRow(r);
    if (!op) return r;
    const nom =
      byKey.get(op.toLowerCase()) ||
      (Number.isFinite(Number(op)) ? byKey.get(String(Number(op))) : '') ||
      '';
    return nom ? { ...r, OperadorNombre: nom } : r;
  });
}

async function completarDescripcionesDisposicion(rows) {
  if (!rows?.length) return rows;
  const codeOf = (r) => Number(r.DisposicionEgreso ?? r.disposicionEgreso);
  const pendientes = rows.filter(
    (r) =>
      Number.isFinite(codeOf(r)) &&
      codeOf(r) > 0 &&
      !String(r.DisposicionEgresoDescripcion || r.disposicionEgresoDescripcion || '').trim(),
  );
  if (!pendientes.length) return rows;

  let cat = [];
  try {
    cat = await executeQuery(
      `SELECT Valor, LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion FROM dbo.imDisposicionEgreso`,
    );
  } catch (err) {
    console.warn('[movimientos] disposiciones:', err.message);
    cat = [
      { Valor: 1, Descripcion: 'ALTA MEDICA' },
      { Valor: 2, Descripcion: 'DERIVADO' },
      { Valor: 3, Descripcion: 'DEFUNCION' },
      { Valor: 4, Descripcion: 'ALTA VOLUNTARIA' },
    ];
  }
  const byCode = new Map();
  for (const c of cat || []) {
    const desc = String(c.Descripcion ?? c.descripcion ?? '').trim();
    if (!desc) continue;
    const valor = c.Valor ?? c.valor;
    byCode.set(String(Number(valor)), desc);
    byCode.set(String(valor ?? '').trim().toLowerCase(), desc);
  }
  return rows.map((r) => {
    if (String(r.DisposicionEgresoDescripcion || r.disposicionEgresoDescripcion || '').trim()) {
      return r;
    }
    const n = codeOf(r);
    if (!Number.isFinite(n) || n <= 0) return r;
    const desc = byCode.get(String(n)) || '';
    return desc ? { ...r, DisposicionEgresoDescripcion: desc } : r;
  });
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
  return completarDescripcionesDisposicion(
    await completarNombresOperador(rows.map(_mapMovimientoIso)),
  );
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

  const ultimo = await asegurarMovimientoDeIngreso(num, { fecha: cDate, hora: cTime });
  if (!ultimo) {
    throw errorNegocio(
      `La visita ${num} no tiene movimiento de internación ni cama registrada; no se puede egresar.`,
    );
  }
  const cabecera = await obtenerCabeceraVisita(num);
  if (!cabecera) {
    throw errorNegocio(`No se encontró la visita ${num}`, 404);
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
    reqMov.input('op', sql.VarChar(20), String(codOperador));
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
        Diagnostico = CASE WHEN LTRIM(RTRIM(@diag)) = '' THEN m.Diagnostico ELSE @diag END,
        Operador = CASE
          WHEN LTRIM(RTRIM(ISNULL(CAST(m.Operador AS varchar(40)), ''))) IN ('', '0')
          THEN @op
          ELSE m.Operador
        END
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
 * Contexto de reversión: misma cama, conflictos y textos para la UI.
 * No se reubica a otra cama: si la original no está disponible, se bloquea.
 */
async function resolverContextoRevertirEgreso(numeroVisita) {
  const num = parseInt(numeroVisita, 10);
  if (isNaN(num)) {
    const err = new Error('Visita inválida');
    err.statusCode = 400;
    throw err;
  }

  const visRows = await executeQuery(
    `
      SELECT
        ISNULL(TRY_CAST(v.FECHAEGRESO AS int), 0) AS FechaEgreso,
        LTRIM(RTRIM(ISNULL(v.VALORHABITACIONCAMA, ''))) AS ValorHabitacionCama,
        LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) AS ValorSector,
        ISNULL(TRY_CAST(v.IDPACIENTE AS int), 0) AS IdPaciente,
        LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS PacienteNombre
      FROM dbo.imVisita v
      LEFT JOIN dbo.imPacientes p ON p.IdPaciente = v.IDPACIENTE
      WHERE v.NumeroVisita = @p0
    `,
    [{ value: num }],
  );
  const visita = visRows?.[0];
  if (!visita) {
    const err = new Error('No se encontró la internación');
    err.statusCode = 404;
    throw err;
  }
  if (!visitaYaEgresada(visita.FechaEgreso)) {
    const err = new Error('Esta internación no tiene egreso para anular');
    err.statusCode = 409;
    throw err;
  }

  const ultimo = await obtenerUltimoMovimientoVisita(num);
  const sector = String(ultimo?.ValorSector || visita.ValorSector || '').trim();
  const cama = codigoCama(
    ultimo?.ValorHabitacionCama || ultimo?.bedId || visita.ValorHabitacionCama,
    sector,
    visita.ValorHabitacionCama,
  );

  let sectorDescripcion = sector;
  if (sector) {
    try {
      const secRows = await executeQuery(
        `
          SELECT TOP 1 LTRIM(RTRIM(ISNULL(Descripcion, Valor))) AS Descripcion
          FROM dbo.imSectores
          WHERE LTRIM(RTRIM(Valor)) = LTRIM(RTRIM(@p0))
        `,
        [{ value: sector }],
      );
      sectorDescripcion = String(secRows?.[0]?.Descripcion || sector).trim() || sector;
    } catch (_) {
      /* catálogo opcional */
    }
  }

  const etiquetaUbicacion = cama
    ? sectorDescripcion
      ? `cama ${cama} (${sectorDescripcion})`
      : `cama ${cama}`
    : '';

  const ctx = {
    numeroVisita: num,
    idPaciente: Number(visita.IdPaciente) || 0,
    pacienteNombre: String(visita.PacienteNombre || 'el paciente').trim() || 'el paciente',
    cama,
    sector,
    sectorDescripcion,
    etiquetaUbicacion,
    camaEstado: cama ? 'inexistente' : 'sin_cama',
    estadoCamaDescripcion: '',
    ocupanteNombre: '',
    ultimo,
    fechaIngresoMov: clarionInt(ultimo?.FechaAdmision),
    conflictos: [],
    avisos: [],
  };

  const camaVisita = String(visita.ValorHabitacionCama || '').trim();
  const camaMov = String(ultimo?.ValorHabitacionCama || ultimo?.bedId || '').trim();
  if (camaVisita && camaMov && codigoCama(camaVisita, sector) !== codigoCama(camaMov, sector)) {
    ctx.avisos.push({
      codigo: 'desalineado',
      mensaje: `La internación y el último movimiento no coinciden en la cama. Se usará la del último movimiento (${etiquetaUbicacion || camaMov}).`,
    });
  }

  if (ctx.idPaciente > 0) {
    try {
      const otras = await executeQuery(
        `
          SELECT TOP 1 NumeroVisita
          FROM dbo.imVisita
          WHERE TRY_CAST(IDPACIENTE AS int) = @p0
            AND NumeroVisita <> @p1
            AND UPPER(LTRIM(RTRIM(COALESCE(ClasePaciente, '')))) = 'I'
            AND (
              FECHAEGRESO IS NULL
              OR TRY_CAST(FECHAEGRESO AS int) IS NULL
              OR TRY_CAST(FECHAEGRESO AS int) = 0
            )
        `,
        [{ value: ctx.idPaciente }, { value: num }],
      );
      if (otras?.[0]) {
        ctx.conflictos.push({
          codigo: 'otra_internacion',
          mensaje: `${ctx.pacienteNombre} ya tiene otra internación abierta. No se puede reabrir esta hasta que esa quede egresada.`,
        });
      }
    } catch (_) {
      /* ClasePaciente puede no existir en algún tenant */
    }
  }

  try {
    const epi = await executeQuery(
      `SELECT COUNT(1) AS n FROM dbo.imHCEpicrisis WHERE IdVisita = @p0`,
      [{ value: num }],
    );
    if (Number(epi?.[0]?.n) > 0) {
      ctx.avisos.push({
        codigo: 'epicrisis',
        mensaje: 'Esta internación ya tiene epicrisis cargada. Al anular el egreso, esa epicrisis sigue en la historia.',
      });
    }
  } catch (_) {
    /* tabla opcional */
  }

  if (!cama || !sector) {
    ctx.camaEstado = 'sin_cama';
    return finalizarContextoRevertir(ctx);
  }

  const bedRows = await executeQuery(
    `
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(hc.ValorHabitacionCama, ''))) AS ValorHabitacionCama,
        LTRIM(RTRIM(ISNULL(hc.ValorEstadoCama, ''))) AS ValorEstadoCama,
        ISNULL(TRY_CAST(hc.NumeroVisita AS int), 0) AS NumeroVisita,
        LTRIM(RTRIM(ISNULL(ec.Descripcion, hc.ValorEstadoCama))) AS EstadoDescripcion
      FROM dbo.imHabitacionCamas hc
      LEFT JOIN dbo.imEstadoCama ec ON LTRIM(RTRIM(ec.Valor)) = LTRIM(RTRIM(hc.ValorEstadoCama))
      WHERE LTRIM(RTRIM(hc.ValorHabitacionCama)) = LTRIM(RTRIM(@p0))
        AND LTRIM(RTRIM(hc.ValorSector)) = LTRIM(RTRIM(@p1))
    `,
    [{ value: cama }, { value: sector }],
  );
  const bed = bedRows?.[0];
  if (!bed) {
    ctx.camaEstado = 'inexistente';
    ctx.conflictos.push({
      codigo: 'cama_inexistente',
      mensaje: `No se encontró la ${etiquetaUbicacion || 'cama anterior'}. ${ctx.pacienteNombre} no puede volver a esa ubicación hasta que se regularice.`,
    });
    return finalizarContextoRevertir(ctx);
  }

  const ocupante = Number(bed.NumeroVisita) || 0;
  const estado = String(bed.ValorEstadoCama || '').trim().toUpperCase();
  ctx.estadoCamaDescripcion = String(bed.EstadoDescripcion || estado).trim();

  if (ocupante === num) {
    ctx.camaEstado = 'propia';
    ctx.avisos.push({
      codigo: 'cama_propia',
      mensaje: `La ${etiquetaUbicacion} sigue figurando con ${ctx.pacienteNombre}. Se anula el egreso y se deja esa misma ubicación.`,
    });
    return finalizarContextoRevertir(ctx);
  }

  if (ocupante > 0) {
    ctx.camaEstado = 'ocupada';
    try {
      const occNom = await executeQuery(
        `
          SELECT TOP 1 LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS Nombre
          FROM dbo.imVisita v
          LEFT JOIN dbo.imPacientes p ON p.IdPaciente = v.IDPACIENTE
          WHERE v.NumeroVisita = @p0
        `,
        [{ value: ocupante }],
      );
      ctx.ocupanteNombre = String(occNom?.[0]?.Nombre || '').trim();
    } catch (_) {
      ctx.ocupanteNombre = '';
    }
    const quienOcupa = ctx.ocupanteNombre ? ` Hoy está ${ctx.ocupanteNombre}.` : '';
    ctx.conflictos.push({
      codigo: 'cama_ocupada',
      mensaje: `No se puede volver a la ${etiquetaUbicacion}: esa cama ya está ocupada.${quienOcupa} Hasta que quede libre, ${ctx.pacienteNombre} no puede regresar ahí.`,
    });
    return finalizarContextoRevertir(ctx);
  }

  if (estado && estado !== 'U') {
    ctx.camaEstado = 'no_disponible';
    const detalle = ctx.estadoCamaDescripcion && ctx.estadoCamaDescripcion !== estado
      ? ` (${ctx.estadoCamaDescripcion})`
      : '';
    ctx.conflictos.push({
      codigo: 'cama_no_disponible',
      mensaje: `No se puede volver a la ${etiquetaUbicacion}: esa cama no está libre${detalle}. Hasta que se libere, ${ctx.pacienteNombre} no puede regresar ahí.`,
    });
    return finalizarContextoRevertir(ctx);
  }

  ctx.camaEstado = 'libre';
  return finalizarContextoRevertir(ctx);
}

function finalizarContextoRevertir(ctx) {
  ctx.puedeRevertir = ctx.conflictos.length === 0;
  ctx.mensaje = mensajeEstadoRevertir(ctx);
  return ctx;
}

function mensajeEstadoRevertir(ctx) {
  const quien = ctx.pacienteNombre;
  const donde = ctx.etiquetaUbicacion;
  if (!ctx.puedeRevertir && ctx.conflictos.length) {
    return ctx.conflictos.map((c) => c.mensaje).join('\n\n');
  }
  if (ctx.camaEstado === 'sin_cama') {
    return `Se va a anular el egreso de ${quien}. Volverá a internación sin cama, como estaba.`;
  }
  return `Se va a anular el egreso de ${quien}. Volverá a internación en la ${donde}.`;
}

async function consultarEstadoRevertirEgreso(numeroVisita) {
  const ctx = await resolverContextoRevertirEgreso(numeroVisita);
  return {
    pacienteNombre: ctx.pacienteNombre,
    cama: ctx.cama,
    sector: ctx.sector,
    sectorDescripcion: ctx.sectorDescripcion,
    etiquetaUbicacion: ctx.etiquetaUbicacion,
    camaEstado: ctx.camaEstado,
    puedeRevertir: ctx.puedeRevertir,
    mensaje: ctx.mensaje,
    conflictos: ctx.conflictos,
    avisos: ctx.avisos,
  };
}

/**
 * Revierte un egreso hospitalario (solo admin).
 * Solo restaura la misma cama. Si esa cama no está disponible, no se toca nada.
 */
async function revertirEgresoVisita(numeroVisita, opciones = {}) {
  const ctx = await resolverContextoRevertirEgreso(numeroVisita);
  if (!ctx.puedeRevertir) {
    const err = new Error(ctx.mensaje);
    err.statusCode = 409;
    throw err;
  }

  const num = ctx.numeroVisita;
  const { cama, sector, ultimo, fechaIngresoMov } = ctx;
  const reubicarEnCama = ctx.camaEstado === 'libre' || ctx.camaEstado === 'propia';

  const pool = await getRequestPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (reubicarEnCama && cama && sector) {
      const reqOcc = new sql.Request(tx);
      reqOcc.input('nv', sql.Int, num);
      reqOcc.input('cama', sql.VarChar(20), cama);
      reqOcc.input('sec', sql.VarChar(20), sector);
      reqOcc.input('fi', sql.Int, fechaIngresoMov);
      const occ = await reqOcc.query(`
        UPDATE dbo.imHabitacionCamas
        SET
          FechaIngreso = CASE WHEN @fi > 0 THEN @fi ELSE FechaIngreso END,
          FechaEgreso = 0,
          ValorEstadoCama = 'O',
          NumeroVisita = @nv,
          Observaciones = ''
        WHERE LTRIM(RTRIM(ValorHabitacionCama)) = LTRIM(RTRIM(@cama))
          AND LTRIM(RTRIM(ValorSector)) = LTRIM(RTRIM(@sec))
          AND (
            ISNULL(TRY_CAST(NumeroVisita AS int), 0) = 0
            OR TRY_CAST(NumeroVisita AS int) = @nv
          )
          AND (
            UPPER(LTRIM(RTRIM(ISNULL(ValorEstadoCama, 'U')))) = 'U'
            OR TRY_CAST(NumeroVisita AS int) = @nv
          )
      `);
      if (!occ?.rowsAffected?.[0]) {
        const err = new Error(
          `No se pudo volver a la ${ctx.etiquetaUbicacion}: en este momento ya no está libre.`,
        );
        err.statusCode = 409;
        throw err;
      }
    }

    if (ultimo) {
      const reqMov = new sql.Request(tx);
      reqMov.input('nv', sql.Int, num);
      reqMov.input('fa', sql.Int, clarionInt(ultimo.FechaAdmision));
      reqMov.input('ha', sql.Int, clarionInt(ultimo.HoraAdmision));
      reqMov.input('estado', sql.VarChar(5), reubicarEnCama ? 'O' : String(ultimo.EstadoCama || '').trim());
      const codOp = Number(opciones.codOperador);
      reqMov.input('op', sql.VarChar(20), Number.isFinite(codOp) && codOp > 0 ? String(codOp) : '');
      await reqMov.query(`
        UPDATE dbo.imVisitaMovimiento
        SET
          FechaEgreso = 0,
          HoraEgreso = 0,
          DisposicionEgreso = 0,
          EstadoCama = CASE
            WHEN LTRIM(RTRIM(@estado)) = '' THEN EstadoCama
            ELSE @estado
          END,
          Operador = CASE
            WHEN LTRIM(RTRIM(@op)) = '' THEN Operador
            WHEN LTRIM(RTRIM(ISNULL(CAST(Operador AS varchar(40)), ''))) IN ('', '0')
            THEN @op
            ELSE Operador
          END
        WHERE NumeroVisita = @nv
          AND FechaAdmision = @fa
          AND HoraAdmision = @ha
      `);
    }

    const reqVis = new sql.Request(tx);
    reqVis.input('nv', sql.Int, num);
    reqVis.input('reubicar', sql.Int, reubicarEnCama ? 1 : 0);
    reqVis.input('cama', sql.VarChar(20), cama || '');
    reqVis.input('sec', sql.VarChar(20), sector || '');
    await reqVis.query(`
      UPDATE dbo.imVisita
      SET
        FechaEgreso = 0,
        HoraEgreso = 0,
        DisposicionEgreso = 0,
        DiagnosticoEgreso = '',
        OperadorEgreso = 0,
        ValorHabitacionCama = CASE WHEN @reubicar = 1 THEN @cama ELSE ValorHabitacionCama END,
        ValorSector = CASE WHEN @reubicar = 1 AND LTRIM(RTRIM(@sec)) <> '' THEN @sec ELSE ValorSector END
      WHERE NumeroVisita = @nv
    `);

    await tx.commit();
    const message = reubicarEnCama
      ? `Se anuló el egreso. ${ctx.pacienteNombre} volvió a la ${ctx.etiquetaUbicacion}.`
      : `Se anuló el egreso. ${ctx.pacienteNombre} volvió a internación, sin cama, como estaba.`;
    return {
      success: true,
      message,
      data: {
        numeroVisita: num,
        cama: reubicarEnCama ? cama : '',
        sector: reubicarEnCama ? sector : ctx.sector,
        sinCama: !reubicarEnCama,
      },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {
      /* transacción ya abortada */
    }
    console.error('Error al revertir egreso:', err);
    throw err;
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
    throw errorNegocio(
      'Faltan datos obligatorios para el movimiento de cama. Se requiere: FechaAdmision, HoraAdmision, FechaEgreso, HoraEgreso, bedId, ValorSector, Operador, FechaCarga, HoraCarga',
      400,
    );
  }

  const ultimoMovimiento = await asegurarMovimientoDeIngreso(num, {
    fecha: FechaEgreso,
    hora: HoraEgreso,
  });
  if (!ultimoMovimiento) {
    throw errorNegocio(
      `La visita ${num} no tiene movimiento de internación ni cama registrada. Asignale una cama antes de trasladarla.`,
    );
  }
  if (visitaYaEgresada(ultimoMovimiento.FechaEgreso)) {
    throw errorNegocio(`La visita ${num} ya tiene egreso; no se puede trasladar`);
  }

  const cabecera = await obtenerCabeceraVisita(num);
  if (!cabecera) {
    throw errorNegocio(`No se encontró información del paciente para la visita ${num}`, 404);
  }
  if (visitaYaEgresada(cabecera.FechaEgreso)) {
    throw errorNegocio(`La visita ${num} ya tiene egreso hospitalario; no se puede trasladar`);
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
    throw errorNegocio(
      `La visita ${num} no tiene cama ocupada en internación. Usá "Asignar cama" para ubicar al paciente.`,
    );
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
    throw errorNegocio(`La cama destino ${camaDestino} en el sector ${sectorDestino} no existe`);
  }

  const estadoCama = camaDestinoResult[0].ValorEstadoCama;
  if (estadoCama !== 'U') {
    throw errorNegocio(
      `La cama destino ${camaDestino} en el sector ${sectorDestino} no está disponible. Estado actual: ${camaDestinoResult[0].EstadoDescripcion || estadoCama}`,
    );
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
    const result = normalizarFilas(await executeQuery(sql, [{ value: limite }]));
    
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
  consultarEstadoRevertirEgreso,
  revertirEgresoVisita,
  obtenerMovimientosVisita,
  moverPacienteACamaVacia,
  intercambiarCamasPacientes,
  obtenerMovimientosRecientes,
  obtenerPacientesInternadosSinCama,
  asignarPacienteACama,
};
