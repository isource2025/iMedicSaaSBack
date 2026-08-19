const { executeQuery } = require('../models/db');

/**
 * Esquema de dbo.imNotificaciones.
 * Si la tabla no existe en el tenant, se crea. Si ya existe (p. ej. Aclysa),
 * se detectan las columnas por INFORMATION_SCHEMA o por NOTIFICACIONES_COL_* en .env.
 */

let cached = null;
let ensuredTable = false;

async function ensureImNotificacionesTable() {
	if (ensuredTable) return;
	try {
		await executeQuery(`
		IF OBJECT_ID(N'dbo.imNotificaciones', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imNotificaciones (
				IdNotificacion INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
				ValorPersonal INT NOT NULL,
				TipoNotificacion VARCHAR(50) NOT NULL,
				DescNotificacion VARCHAR(250) NOT NULL,
				EntidadTipo VARCHAR(50) NULL,
				EntidadId INT NULL,
				DatosJSON NVARCHAR(MAX) NULL,
				Leida BIT NOT NULL CONSTRAINT DF_imNotificaciones_Leida DEFAULT (0),
				FechaCarga DATETIME NOT NULL CONSTRAINT DF_imNotificaciones_FechaCarga DEFAULT (GETDATE()),
				MostrarHasta DATETIME NULL,
				Marca VARCHAR(20) NULL
			);
			CREATE INDEX IX_imNotificaciones_ValorPersonal ON dbo.imNotificaciones (ValorPersonal);
			CREATE INDEX IX_imNotificaciones_Leida ON dbo.imNotificaciones (Leida);
			CREATE INDEX IX_imNotificaciones_FechaCarga ON dbo.imNotificaciones (FechaCarga);
		END
		`);
		ensuredTable = true;
		cached = null;
	} catch (e) {
		console.warn('[notificaciones] No se pudo asegurar imNotificaciones:', e.message);
	}
}

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
  await ensureImNotificacionesTable();

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
  ensureImNotificacionesTable,
};
