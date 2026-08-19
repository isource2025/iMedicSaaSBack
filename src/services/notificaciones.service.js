const { executeQuery } = require('../models/db');
const { resolveImNotificacionesColumns, sqlEscapeIdent } = require('./notificacionesColumns');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');

let warnedSchemaUnusable = false;

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function getCols() {
  return resolveImNotificacionesColumns();
}

/**
 * Lista notificaciones del usuario (paginado).
 */
async function listarPorUsuario(valorPersonal, page = 1, limit = 20, soloNoLeidas = false) {
  const cols = await getCols();
  if (!cols.usable) {
    return {
      data: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }

  const id = sqlEscapeIdent(cols.id);
  const vp = sqlEscapeIdent(cols.valorPersonal);
  const leida = sqlEscapeIdent(cols.leida);
  const fecha = sqlEscapeIdent(cols.fechaCarga);
  const desc = sqlEscapeIdent(cols.descNotificacion);
  const tipo = sqlEscapeIdent(cols.tipoNotificacion);
  const entT = sqlEscapeIdent(cols.entidadTipo);
  const entI = sqlEscapeIdent(cols.entidadId);
  const json = sqlEscapeIdent(cols.datosJson);

  const where = soloNoLeidas
    ? `WHERE ${vp} = @param0 AND ${leida} = 0`
    : `WHERE ${vp} = @param0`;

  const countRows = await executeQuery(
    `SELECT COUNT(*) AS total FROM dbo.imNotificaciones ${where}`,
    [{ value: valorPersonal }]
  );
  const total = countRows[0]?.total ?? 0;

  const offset = (page - 1) * limit;
  const selectList = `
        ${id} AS IdNotificacion,
        ${vp} AS ValorPersonal,
        ${tipo} AS TipoNotificacion,
        ${desc} AS DescNotificacion,
        ${entT} AS EntidadTipo,
        ${entI} AS EntidadId,
        ${leida} AS Leida,
        ${json} AS DatosJSON,
        ${fecha} AS FechaCarga
      FROM dbo.imNotificaciones
      ${where}`;

  let data;
  try {
    data = await executeQuery(
      `
      SELECT
        ${selectList}
      ORDER BY ${fecha} DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
      `,
      [{ value: valorPersonal, type: 'Int' }],
    );
  } catch (err) {
    const topN = offset + limit;
    const rows = await executeQuery(
      `
      SELECT TOP ${topN}
        ${selectList}
      ORDER BY ${fecha} DESC
      `,
      [{ value: valorPersonal, type: 'Int' }],
    );
    data = (rows || []).slice(offset);
  }

  const mapped = (data || []).map((n) => ({
    ...n,
    DatosJSON: n.DatosJSON ? safeParseJson(n.DatosJSON) : null,
  }));

  return {
    data: mapped,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  };
}

async function marcarLeida(idNotificacion, valorPersonal) {
  const cols = await getCols();
  if (!cols.usable) return { success: false };

  const id = sqlEscapeIdent(cols.id);
  const vp = sqlEscapeIdent(cols.valorPersonal);
  const leida = sqlEscapeIdent(cols.leida);

  await executeQuery(
    `
    UPDATE dbo.imNotificaciones
    SET ${leida} = 1
    WHERE ${id} = @param0 AND ${vp} = @param1
    `,
    [{ value: idNotificacion }, { value: valorPersonal }]
  );
  return { success: true };
}

async function marcarTodasLeidas(valorPersonal) {
  const cols = await getCols();
  if (!cols.usable) return { success: false };

  const vp = sqlEscapeIdent(cols.valorPersonal);
  const leida = sqlEscapeIdent(cols.leida);

  await executeQuery(
    `
    UPDATE dbo.imNotificaciones
    SET ${leida} = 1
    WHERE ${vp} = @param0 AND ${leida} = 0
    `,
    [{ value: valorPersonal }]
  );
  return { success: true };
}

async function contarNoLeidas(valorPersonal) {
  const cols = await getCols();
  if (!cols.usable) return 0;

  const vp = sqlEscapeIdent(cols.valorPersonal);
  const leida = sqlEscapeIdent(cols.leida);

  const rows = await executeQuery(
    `
    SELECT COUNT(*) AS c
    FROM dbo.imNotificaciones
    WHERE ${vp} = @param0 AND ${leida} = 0
    `,
    [{ value: valorPersonal }]
  );
  return rows[0]?.c ?? 0;
}

/**
 * Inserta una notificación (uso interno).
 */
async function crear({
  valorPersonal,
  tipo,
  descripcion,
  entidadTipo = null,
  entidadId = null,
  datos = null,
  mostrarHasta = null,
  marca = null,
}) {
  const cols = await getCols();
  if (!cols.usable) {
    if (!warnedSchemaUnusable) {
      warnedSchemaUnusable = true;
      console.warn(
        '[notificaciones] Esquema imNotificaciones no usable; se omiten inserciones. Ejecute scripts/migrar_imNotificaciones_local_a_aclysa.sql o configure NOTIFICACIONES_COL_* en .env',
      );
    }
    return { success: false };
  }

  const hasta = mostrarHasta || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const datosStr = datos ? JSON.stringify(datos) : null;

  const id = sqlEscapeIdent(cols.id);
  const vp = sqlEscapeIdent(cols.valorPersonal);
  const t = sqlEscapeIdent(cols.tipoNotificacion);
  const d = sqlEscapeIdent(cols.descNotificacion);
  const et = sqlEscapeIdent(cols.entidadTipo);
  const ei = sqlEscapeIdent(cols.entidadId);
  const j = sqlEscapeIdent(cols.datosJson);
  const leida = sqlEscapeIdent(cols.leida);
  const fc = sqlEscapeIdent(cols.fechaCarga);

  const names = await loadColumnNamesForInsert();
  const hasMostrarHasta = names && names.some((x) => String(x).toLowerCase() === 'mostrarhasta');
  const hasMarca = names && names.some((x) => String(x).toLowerCase() === 'marca');

  let insertCols = `${vp}, ${t}, ${d}, ${et}, ${ei}, ${j}, ${leida}, ${fc}`;
  let insertVals = '@param0, @param1, @param2, @param3, @param4, @param5, 0, GETDATE()';
  const params = [
    { value: valorPersonal, type: 'Int' },
    { value: tipo, type: 'VarChar', length: 50 },
    { value: normalizarTextoParaClarionAnsi(descripcion, { maxLength: 250 }), type: 'VarChar', length: 250 },
    { value: entidadTipo, type: 'VarChar', length: 50 },
    { value: entidadId, type: 'Int' },
    { value: datosStr, type: 'NVarChar' },
  ];

  let nextIdx = 6;
  if (hasMostrarHasta) {
    insertCols += ', [MostrarHasta]';
    insertVals += `, @param${nextIdx}`;
    params.push({ value: hasta });
    nextIdx += 1;
  }
  if (hasMarca) {
    insertCols += ', [Marca]';
    insertVals += `, @param${nextIdx}`;
    params.push({ value: marca });
  }

  try {
    const rows = await executeQuery(
      `
      INSERT INTO dbo.imNotificaciones (${insertCols})
      OUTPUT INSERTED.${id}
      VALUES (${insertVals})
      `,
      params
    );
    const outKey = Object.keys(rows[0] || {})[0];
    return { success: true, idNotificacion: rows[0]?.[outKey] };
  } catch (e) {
    try {
      const rows = await executeQuery(
        `
        INSERT INTO dbo.imNotificaciones (${insertCols})
        VALUES (${insertVals});
        SELECT SCOPE_IDENTITY() AS IdNotificacion
        `,
        params,
      );
      return { success: true, idNotificacion: rows[0]?.IdNotificacion };
    } catch (e2) {
      console.warn('[notificaciones] crear falló (esquema distinto):', e2.message || e.message);
      return { success: false };
    }
  }
}

async function loadColumnNamesForInsert() {
  try {
    const rows = await executeQuery(
      `
      SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='imNotificaciones'
    `,
      []
    );
    return (rows || []).map((r) => r.c);
  } catch {
    return null;
  }
}

module.exports = {
  listarPorUsuario,
  marcarLeida,
  marcarTodasLeidas,
  contarNoLeidas,
  crear,
};
