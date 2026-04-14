const { executeQuery } = require('../models/db');

/**
 * Capa de compatibilidad con la tabla dbo.imNotificaciones ya existente (p. ej. Aclysa).
 *
 * IMPORTANTE: el backend NO ejecuta CREATE/ALTER sobre esta tabla; solo lee
 * INFORMATION_SCHEMA o variables de entorno. Para ver columnas reales use
 * scripts/inspect_imNotificaciones.sql en SSMS.
 *
 * Override explícito (recomendado si la heurística no coincide con Aclysa):
 *   NOTIFICACIONES_COL_VALOR_PERSONAL, NOTIFICACIONES_COL_LEIDA,
 *   NOTIFICACIONES_COL_ID, NOTIFICACIONES_COL_FECHA, NOTIFICACIONES_COL_DESC, NOTIFICACIONES_COL_TIPO
 */

let cached = null;

function bracket(name) {
  if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Nombre de columna no válido: ${name}`);
  }
  return `[${name}]`;
}

function pick(names, predicates) {
  const lower = names.map((n) => ({ n, l: n.toLowerCase() }));
  for (const pred of predicates) {
    const hit = lower.find((x) => pred(x.l, x.n));
    if (hit) return hit.n;
  }
  return null;
}

async function loadColumnsFromDb() {
  try {
    const rows = await executeQuery(
      `
      SELECT COLUMN_NAME AS c
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imNotificaciones'
      ORDER BY ORDINAL_POSITION
    `,
      []
    );
    return (rows || []).map((r) => r.c).filter(Boolean);
  } catch (e) {
    console.warn('[notificacionesColumns] No se pudo leer INFORMATION_SCHEMA:', e.message);
    return null;
  }
}

async function resolveImNotificacionesColumns() {
  if (cached !== null) return cached;

  const envId = process.env.NOTIFICACIONES_COL_ID;
  const envVp = process.env.NOTIFICACIONES_COL_VALOR_PERSONAL;
  const envLeida = process.env.NOTIFICACIONES_COL_LEIDA;
  const envFecha = process.env.NOTIFICACIONES_COL_FECHA;
  const envDesc = process.env.NOTIFICACIONES_COL_DESC;
  const envTipo = process.env.NOTIFICACIONES_COL_TIPO;
  const envEntTipo = process.env.NOTIFICACIONES_COL_ENTIDAD_TIPO;
  const envEntId = process.env.NOTIFICACIONES_COL_ENTIDAD_ID;
  const envJson = process.env.NOTIFICACIONES_COL_DATOS_JSON;

  if (envVp && envLeida) {
    cached = {
      usable: true,
      id: envId || 'IdNotificacion',
      valorPersonal: envVp,
      leida: envLeida,
      fechaCarga: envFecha || 'FechaCarga',
      descNotificacion: envDesc || 'DescNotificacion',
      tipoNotificacion: envTipo || 'TipoNotificacion',
      entidadTipo: envEntTipo || 'EntidadTipo',
      entidadId: envEntId || 'EntidadId',
      datosJson: envJson || 'DatosJSON',
    };
    return cached;
  }

  const names = await loadColumnsFromDb();
  if (!names || names.length === 0) {
    console.warn('[notificaciones] Tabla dbo.imNotificaciones no encontrada o sin columnas.');
    cached = { usable: false };
    return cached;
  }

  const id =
    pick(names, [
      (l) => l === 'idnotificacion',
      (l) => l.startsWith('id') && l.includes('notif'),
      (l) => l === 'id',
    ]) || 'IdNotificacion';

  const valorPersonal = pick(names, [
    (l) => l === 'valorpersonal',
    (l) => l === 'idvalorpersonal' || l === 'valor_personal' || l === 'id_usuario_destino',
    (l) => l.includes('valor') && l.includes('personal'),
    (l) => l === 'vp' || l === 'idusuario' || l === 'id_usuario',
    (l) => l.includes('destinatario'),
    (l) =>
      (l.includes('usuario') || l.includes('operador') || l.includes('personal')) &&
      !l.includes('fecha') &&
      !l.includes('carga') &&
      !l.includes('notificacion') &&
      l !== 'idnotificacion',
  ]);

  const leida = pick(names, [
    (l) => l === 'leida' || l === 'leido',
    (l) => l.includes('leida') || l.includes('leido'),
    (l) => l === 'visto' || l === 'leido_notif',
    (l) => l.includes('read') && !l.includes('thread'),
  ]);

  const fechaCarga =
    pick(names, [
      (l) => l === 'fechacarga' || l === 'fecha_carga',
      (l) => l.includes('fechacarga'),
      (l) => l.includes('fecha') && (l.includes('alta') || l.includes('crea')),
    ]) || 'FechaCarga';

  const descNotificacion =
    pick(names, [
      (l) => l === 'descnotificacion' || l === 'descripcion',
      (l) => l.includes('desc') && l.includes('notif'),
      (l) => l === 'mensaje' || l === 'texto' || l === 'detalle',
    ]) || 'DescNotificacion';

  const tipoNotificacion =
    pick(names, [
      (l) => l === 'tiponotificacion' || l === 'tipo_notificacion',
      (l) => l.includes('tipo') && l.includes('notif'),
      (l) => l === 'tipo',
    ]) || 'TipoNotificacion';

  const entidadTipo =
    pick(names, [(l) => l === 'entidadtipo' || l === 'tipoentidad', (l) => l.includes('entidad') && l.includes('tipo')]) ||
    'EntidadTipo';

  const entidadId =
    pick(names, [(l) => l === 'entidadid' || l === 'identidad', (l) => l.includes('entidad') && l.includes('id')]) ||
    'EntidadId';

  const datosJson =
    pick(names, [
      (l) => l === 'datosjson' || l === 'datos_json',
      (l) => l.includes('json'),
      (l) => l.includes('datos') && l.includes('extra'),
    ]) || 'DatosJSON';

  if (!valorPersonal || !leida) {
    console.warn(
      '[notificaciones] imNotificaciones sin columnas reconocidas para usuario/leída. Defina NOTIFICACIONES_COL_VALOR_PERSONAL y NOTIFICACIONES_COL_LEIDA en .env'
    );
    cached = { usable: false, names };
    return cached;
  }

  cached = {
    usable: true,
    id,
    valorPersonal,
    leida,
    fechaCarga,
    descNotificacion,
    tipoNotificacion,
    entidadTipo,
    entidadId,
    datosJson,
  };
  return cached;
}

function sqlEscapeIdent(name) {
  return bracket(name);
}

module.exports = {
  resolveImNotificacionesColumns,
  sqlEscapeIdent,
};
