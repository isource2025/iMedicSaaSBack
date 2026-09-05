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

const TIPOS_PEDIDO = `('PEDIDO_ESTUDIO', 'INTERCONSULTA')`;

function exprEsNotifPedido(cols, tableAlias = '') {
  const p = tableAlias ? `${tableAlias}.` : '';
  const parts = [];
  if (cols.tipoNotificacion) {
    parts.push(
      `UPPER(LTRIM(RTRIM(ISNULL(${p}${sqlEscapeIdent(cols.tipoNotificacion)}, '')))) IN ${TIPOS_PEDIDO}`,
    );
  }
  if (cols.entidadTipo) {
    parts.push(
      `UPPER(LTRIM(RTRIM(ISNULL(${p}${sqlEscapeIdent(cols.entidadTipo)}, '')))) IN ${TIPOS_PEDIDO}`,
    );
  }
  return parts.length ? `(${parts.join(' OR ')})` : '0=1';
}

/** Pedido aún “libre”: existe, sin protocolo y sin toma. */
function exprPedidoLibre(cols, tableAlias = '') {
  if (!cols.entidadId) return '0=1';
  const p = tableAlias ? `${tableAlias}.` : '';
  const entId = `${p}${sqlEscapeIdent(cols.entidadId)}`;
  return `EXISTS (
    SELECT 1
    FROM dbo.imPedidosEstudios pe
    LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
    WHERE pe.IdPedido = ${entId}
      AND (pe.IdProtocolo IS NULL OR pe.IdProtocolo = 0)
      AND toma.IdPedido IS NULL
  )`;
}

async function ensureTomaTableSafe() {
  try {
    await executeQuery(`
      IF OBJECT_ID(N'dbo.imPedidosEstudiosToma', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.imPedidosEstudiosToma (
          IdPedido INT NOT NULL PRIMARY KEY,
          Matricula INT NOT NULL,
          CodOperador INT NULL,
          FechaToma DATETIME NOT NULL CONSTRAINT DF_imPedidosEstudiosToma_Fecha_notif DEFAULT (GETDATE())
        );
      END
    `);
  } catch (e) {
    console.warn('[notificaciones] ensureTomaTable:', e.message);
  }
}

/**
 * Borra avisos de un pedido (cualquier destinatario) por EntidadTipo/EntidadId.
 */
async function eliminarPorEntidadPedido(idPedido) {
  const id = Number(idPedido);
  if (!Number.isFinite(id) || id <= 0) return { success: false, deleted: 0 };
  try {
    const cols = await getCols();
    if (!cols.usable || !cols.entidadId) return { success: false, deleted: 0 };

    const entId = sqlEscapeIdent(cols.entidadId);
    const esPedido = exprEsNotifPedido(cols);
    const result = await executeQuery(
      `
      DELETE FROM dbo.imNotificaciones
      WHERE ${entId} = @param0
        AND ${esPedido}
      `,
      [{ value: id, type: 'Int' }],
    );
    const deleted = Number(result?.rowsAffected?.[0] ?? result?.length ?? 0) || 0;
    return { success: true, deleted };
  } catch (e) {
    console.warn('[notificaciones] eliminarPorEntidadPedido:', e.message);
    return { success: false, deleted: 0 };
  }
}

/**
 * Elimina avisos de pedido ya inexistentes, tomados o cumplidos.
 * Si valorPersonal viene, solo de ese usuario (p. ej. al abrir la campanita).
 */
async function limpiarNotificacionesPedidosObsoletas(valorPersonal = null) {
  try {
    const cols = await getCols();
    if (!cols.usable || !cols.entidadId) return { success: false, deleted: 0 };
    await ensureTomaTableSafe();

    const esPedido = exprEsNotifPedido(cols);
    const libre = exprPedidoLibre(cols);
    const vpFilter =
      valorPersonal != null && cols.valorPersonal
        ? `AND ${sqlEscapeIdent(cols.valorPersonal)} = @param0`
        : '';
    const params =
      valorPersonal != null && cols.valorPersonal
        ? [{ value: Number(valorPersonal), type: 'Int' }]
        : [];

    await executeQuery(
      `
      DELETE FROM dbo.imNotificaciones
      WHERE ${esPedido}
        ${vpFilter}
        AND (
          ${sqlEscapeIdent(cols.entidadId)} IS NULL
          OR ${sqlEscapeIdent(cols.entidadId)} <= 0
          OR NOT (${libre})
        )
      `,
      params,
    );
    return { success: true };
  } catch (e) {
    console.warn('[notificaciones] limpiarNotificacionesPedidosObsoletas:', e.message);
    return { success: false };
  }
}

/**
 * Condición de listado/conteo: pedidos solo si no leídos y aún libres;
 * el resto de tipos se listan con la regla habitual de leída.
 */
function whereListadoVisible(cols, { soloNoLeidas }) {
  const vp = sqlEscapeIdent(cols.valorPersonal);
  const leida = sqlEscapeIdent(cols.leida);
  const esPedido = exprEsNotifPedido(cols);
  const libre = exprPedidoLibre(cols);
  const noLeida = `ISNULL(CASE WHEN ISNUMERIC(CAST(${leida} AS varchar(20))) = 1 THEN CAST(${leida} AS INT) ELSE 0 END, 0) = 0`;

  const pedidoOk = `(${esPedido} AND ${noLeida} AND ${libre})`;
  const otras = `(NOT ${esPedido}${soloNoLeidas ? ` AND ${noLeida}` : ''})`;

  return `WHERE ${vp} = @param0 AND (${pedidoOk} OR ${otras})`;
}

/**
 * Lista notificaciones del usuario (paginado).
 * Avisos de pedido: solo no leídos y con pedido libre (el totalizador cubre el resto).
 */
async function listarPorUsuario(valorPersonal, page = 1, limit = 20, soloNoLeidas = false) {
  try {
    const cols = await getCols();
    if (!cols.usable) return emptyList(page, limit);

    await ensureTomaTableSafe();
    await limpiarNotificacionesPedidosObsoletas(valorPersonal);

    const vp = sqlEscapeIdent(cols.valorPersonal);
    const leida = sqlEscapeIdent(cols.leida);
    const orderExpr = cols.fechaCarga
      ? `${sqlEscapeIdent(cols.fechaCarga)} DESC`
      : cols.id
        ? `${sqlEscapeIdent(cols.id)} DESC`
        : '(SELECT 1)';

    const where = whereListadoVisible(cols, { soloNoLeidas });
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

/**
 * Marca leídos solo avisos de pedido/interconsulta (p. ej. al cerrar la campanita).
 * Dejan de listarse; el totalizador de bandeja sigue reflejando libres.
 */
async function marcarPedidosLeidas(valorPersonal) {
  try {
    const cols = await getCols();
    if (!cols.usable) return { success: false };

    const vp = sqlEscapeIdent(cols.valorPersonal);
    const leida = sqlEscapeIdent(cols.leida);
    const esPedido = exprEsNotifPedido(cols);

    await executeQuery(
      `
      UPDATE dbo.imNotificaciones
      SET ${leida} = 1
      WHERE ${vp} = @param0
        AND ISNULL(CASE WHEN ISNUMERIC(CAST(${leida} AS varchar(20))) = 1 THEN CAST(${leida} AS INT) ELSE 0 END, 0) = 0
        AND ${esPedido}
      `,
      [{ value: valorPersonal, type: 'Int' }],
    );
    return { success: true };
  } catch (e) {
    console.warn('[notificaciones] marcarPedidosLeidas:', e.message);
    return { success: false };
  }
}

async function contarNoLeidas(valorPersonal) {
  try {
    const cols = await getCols();
    if (!cols.usable) return 0;

    await ensureTomaTableSafe();
    const params = [{ value: valorPersonal, type: 'Int' }];
    const where = whereListadoVisible(cols, { soloNoLeidas: true });

    let rows;
    try {
      rows = await executeQuery(
        `
        SELECT COUNT(*) AS c
        FROM dbo.imNotificaciones
        ${where}
        `,
        params,
      );
    } catch {
      const vp = sqlEscapeIdent(cols.valorPersonal);
      const leida = sqlEscapeIdent(cols.leida);
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
  marcarPedidosLeidas,
  contarNoLeidas,
  crear,
  eliminarPorEntidadPedido,
  limpiarNotificacionesPedidosObsoletas,
};
