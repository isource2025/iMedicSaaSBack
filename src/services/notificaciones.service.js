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

function emptyList(page, limit) {
  return {
    data: [],
    pagination: { page, limit, total: 0, totalPages: 0 },
  };
}

function colAs(cols, key, alias, nullSql) {
  if (!cols[key]) return `${nullSql} AS ${alias}`;
  return `${sqlEscapeIdent(cols[key])} AS ${alias}`;
}

/**
 * Lista notificaciones del usuario (paginado).
 */
async function listarPorUsuario(valorPersonal, page = 1, limit = 20, soloNoLeidas = false) {
  try {
    const cols = await getCols();
    if (!cols.usable) return emptyList(page, limit);

    const vp = sqlEscapeIdent(cols.valorPersonal);
    const leida = sqlEscapeIdent(cols.leida);
    const orderExpr = cols.fechaCarga
      ? `${sqlEscapeIdent(cols.fechaCarga)} DESC`
      : cols.id
        ? `${sqlEscapeIdent(cols.id)} DESC`
        : '(SELECT 1)';

    const where = soloNoLeidas
      ? `WHERE ${vp} = @param0 AND ISNULL(TRY_CONVERT(INT, ${leida}), 0) = 0`
      : `WHERE ${vp} = @param0`;

    const params = [{ value: valorPersonal, type: 'Int' }];
    let total = 0;
    try {
      const countRows = await executeQuery(
        `SELECT COUNT(*) AS total FROM dbo.imNotificaciones ${where}`,
        params,
      );
      total = Number(countRows[0]?.total ?? countRows[0]?.Total ?? 0);
    } catch {
      const countRows = await executeQuery(
        `SELECT COUNT(*) AS total FROM dbo.imNotificaciones WHERE ${vp} = @param0${
          soloNoLeidas ? ` AND ${leida} = 0` : ''
        }`,
        params,
      );
      total = Number(countRows[0]?.total ?? countRows[0]?.Total ?? 0);
    }

    const offset = (page - 1) * limit;
    const selectList = `
        ${colAs(cols, 'id', 'IdNotificacion', 'CAST(0 AS INT)')},
        ${vp} AS ValorPersonal,
        ${colAs(cols, 'tipoNotificacion', 'TipoNotificacion', 'CAST(NULL AS VARCHAR(50))')},
        ${colAs(cols, 'descNotificacion', 'DescNotificacion', 'CAST(NULL AS VARCHAR(250))')},
        ${colAs(cols, 'entidadTipo', 'EntidadTipo', 'CAST(NULL AS VARCHAR(50))')},
        ${colAs(cols, 'entidadId', 'EntidadId', 'CAST(NULL AS INT)')},
        ${leida} AS Leida,
        ${colAs(cols, 'datosJson', 'DatosJSON', 'CAST(NULL AS NVARCHAR(MAX))')},
        ${colAs(cols, 'fechaCarga', 'FechaCarga', 'CAST(NULL AS DATETIME)')}
      FROM dbo.imNotificaciones
      ${where}`;

    let data;
    try {
      data = await executeQuery(
        `
        SELECT
          ${selectList}
        ORDER BY ${orderExpr}
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `,
        params,
      );
    } catch {
      const topN = offset + limit;
      const rows = await executeQuery(
        `
        SELECT TOP ${topN}
          ${selectList}
        ORDER BY ${orderExpr}
        `,
        params,
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
  } catch (e) {
    console.warn('[notificaciones] listarPorUsuario:', e.message);
    return emptyList(page, limit);
  }
}

async function marcarLeida(idNotificacion, valorPersonal) {
  try {
    const cols = await getCols();
    if (!cols.usable || !cols.id) return { success: false };

    const id = sqlEscapeIdent(cols.id);
    const vp = sqlEscapeIdent(cols.valorPersonal);
    const leida = sqlEscapeIdent(cols.leida);

    await executeQuery(
      `
      UPDATE dbo.imNotificaciones
      SET ${leida} = 1
      WHERE ${id} = @param0 AND ${vp} = @param1
      `,
      [
        { value: idNotificacion, type: 'Int' },
        { value: valorPersonal, type: 'Int' },
      ],
    );
    return { success: true };
  } catch (e) {
    console.warn('[notificaciones] marcarLeida:', e.message);
    return { success: false };
  }
}

async function marcarTodasLeidas(valorPersonal) {
  try {
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
      [{ value: valorPersonal, type: 'Int' }],
    );
    return { success: true };
  } catch (e) {
    console.warn('[notificaciones] marcarTodasLeidas:', e.message);
    return { success: false };
  }
}

async function contarNoLeidas(valorPersonal) {
  try {
    const cols = await getCols();
    if (!cols.usable) return 0;

    const vp = sqlEscapeIdent(cols.valorPersonal);
    const leida = sqlEscapeIdent(cols.leida);
    const params = [{ value: valorPersonal, type: 'Int' }];

    let rows;
    try {
      rows = await executeQuery(
        `
        SELECT COUNT(*) AS c
        FROM dbo.imNotificaciones
        WHERE ${vp} = @param0 AND ISNULL(TRY_CONVERT(INT, ${leida}), 0) = 0
        `,
        params,
      );
    } catch {
      rows = await executeQuery(
        `
        SELECT COUNT(*) AS c
        FROM dbo.imNotificaciones
        WHERE ${vp} = @param0 AND ${leida} = 0
        `,
        params,
      );
    }
    const row = rows?.[0] || {};
    return Number(row.c ?? row.C ?? 0);
  } catch (e) {
    console.warn('[notificaciones] contarNoLeidas:', e.message);
    return 0;
  }
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

  const insertCols = [];
  const insertVals = [];
  const params = [];
  const addParam = (colKey, value, opts) => {
    if (!cols[colKey]) return;
    insertCols.push(sqlEscapeIdent(cols[colKey]));
    const idx = params.length;
    insertVals.push(`@param${idx}`);
    params.push({ value, ...opts });
  };
  addParam('valorPersonal', valorPersonal, { type: 'Int' });
  addParam('tipoNotificacion', tipo, { type: 'VarChar', length: 50 });
  addParam(
    'descNotificacion',
    normalizarTextoParaClarionAnsi(descripcion, { maxLength: 250 }),
    { type: 'VarChar', length: 250 },
  );
  addParam('entidadTipo', entidadTipo, { type: 'VarChar', length: 50 });
  addParam('entidadId', entidadId, { type: 'Int' });
  addParam('datosJson', datosStr, { type: 'NVarChar' });
  if (cols.leida) {
    insertCols.push(sqlEscapeIdent(cols.leida));
    insertVals.push('0');
  }
  if (cols.fechaCarga) {
    insertCols.push(sqlEscapeIdent(cols.fechaCarga));
    insertVals.push('GETDATE()');
  }

  const names = cols.names || (await loadColumnNamesForInsert()) || [];
  const hasMostrarHasta = names.some((x) => String(x).toLowerCase() === 'mostrarhasta');
  const hasMarca = names.some((x) => String(x).toLowerCase() === 'marca');

  if (hasMostrarHasta) {
    insertCols.push('[MostrarHasta]');
    const idx = params.length;
    insertVals.push(`@param${idx}`);
    params.push({ value: hasta });
  }
  if (hasMarca) {
    insertCols.push('[Marca]');
    const idx = params.length;
    insertVals.push(`@param${idx}`);
    params.push({ value: marca });
  }

  if (!insertCols.length) return { success: false };

  const insertColsSql = insertCols.join(', ');
  const insertValsSql = insertVals.join(', ');
  const idSql = cols.id ? sqlEscapeIdent(cols.id) : null;

  try {
    if (idSql) {
      const rows = await executeQuery(
        `
        INSERT INTO dbo.imNotificaciones (${insertColsSql})
        OUTPUT INSERTED.${idSql}
        VALUES (${insertValsSql})
        `,
        params,
      );
      const outKey = Object.keys(rows[0] || {})[0];
      return { success: true, idNotificacion: rows[0]?.[outKey] };
    }
  } catch (e) {
    /* IDENTITY / OUTPUT no disponible en este esquema */
  }
  try {
    const rows = await executeQuery(
      `
      INSERT INTO dbo.imNotificaciones (${insertColsSql})
      VALUES (${insertValsSql});
      SELECT SCOPE_IDENTITY() AS IdNotificacion
      `,
      params,
    );
    return { success: true, idNotificacion: rows[0]?.IdNotificacion };
  } catch (e2) {
    console.warn('[notificaciones] crear falló (esquema distinto):', e2.message);
    return { success: false };
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
