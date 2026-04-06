/**
 * Diagnóstico de imPassword y tablas relacionadas (usuarios / sectores).
 * Evita errores de INSERT (IDENTITY, tipos Clarion vs datetime, columnas faltantes).
 *
 * Uso: desde iMedicWSBack con .env cargado:
 *   node scripts/diagnostico_impassword.js
 *   npm run db:impassword
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');

function printSection(title) {
  console.log(`\n${'═'.repeat(72)}\n  ${title}\n${'═'.repeat(72)}`);
}

async function main() {
  let pool;
  try {
    pool = await connectDB();
    const q = (sql) => pool.request().query(sql);

    printSection('1. Sinónimos llamados imPassword');
    const syn = await q(`
      SELECT s.name AS Esquema, sn.name AS NombreSinonimo, sn.base_object_name AS ObjetoBase
      FROM sys.synonyms sn
      INNER JOIN sys.schemas s ON sn.schema_id = s.schema_id
      WHERE LOWER(sn.name) = N'impassword'
    `);
    if (syn.recordset.length === 0) {
      console.log('  (ninguno — suele ser tabla física dbo.imPassword)');
    } else {
      console.table(syn.recordset);
    }

    printSection('2. Tabla física imPassword (sys.tables)');
    const tbl = await q(`
      SELECT TOP 5
        s.name AS Esquema,
        t.name AS Tabla,
        t.object_id AS ObjectId
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE LOWER(t.name) = N'impassword'
      ORDER BY CASE WHEN s.name = N'dbo' THEN 0 ELSE 1 END, s.name
    `);
    if (tbl.recordset.length === 0) {
      console.log('  ⚠ No hay tabla sys.tables con nombre imPassword.');
    } else {
      console.table(tbl.recordset);
    }

    const objectId =
      tbl.recordset[0]?.ObjectId ??
      (await q(`SELECT OBJECT_ID(N'dbo.imPassword', N'U') AS oid`)).recordset[0]?.oid;

    if (!objectId) {
      printSection('Resumen');
      console.log(
        'No se pudo resolver object_id de imPassword. Revisá nombre de tabla y esquema.'
      );
      process.exit(1);
    }

    printSection(`3. Columnas (detalle) — object_id = ${objectId}`);
    const cols = await q(`
      SELECT
        c.column_id AS Orden,
        c.name AS Columna,
        ty.name AS TipoSql,
        c.max_length AS MaxLen,
        c.precision AS Prec,
        c.scale AS Scale,
        c.is_nullable AS Nullable,
        c.is_identity AS EsIdentity,
        c.is_computed AS EsComputada,
        OBJECT_DEFINITION(c.default_object_id) AS ValorDefault
      FROM sys.columns c
      INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      WHERE c.object_id = ${Number(objectId)}
      ORDER BY c.column_id
    `);
    console.table(cols.recordset);

    printSection('4. COLUMNPROPERTY críticos (como usa users.service.js)');
    const props = await q(`
      SELECT
        COLUMNPROPERTY(${Number(objectId)}, N'ValorPersonal', N'IsIdentity') AS ValorPersonal_IsIdentity,
        COLUMNPROPERTY(${Number(objectId)}, N'FechaActual', N'IsIdentity') AS FechaActual_IsIdentity,
        COLUMNPROPERTY(${Number(objectId)}, N'Grupo', N'AllowsNull') AS Grupo_AllowsNull
    `);
    console.table(props.recordset);

    printSection('5. sys.identity_columns en esta tabla');
    const idcols = await q(`
      SELECT name AS ColumnaIdentity, seed_value, increment_value, last_value
      FROM sys.identity_columns
      WHERE object_id = ${Number(objectId)}
    `);
    if (idcols.recordset.length === 0) {
      console.log('  (vacío — SQL Server no expone IDENTITY aquí; igual puede haber reglas en la app)');
    } else {
      console.table(idcols.recordset);
    }

    printSection('6. INFORMATION_SCHEMA — FechaActual y tipos');
    const isc = await q(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE UPPER(TABLE_NAME) = N'IMPASSWORD'
        AND COLUMN_NAME IN (N'ValorPersonal', N'FechaActual', N'MarcadeBaja', N'Grupo', N'NombreRed', N'Password')
      ORDER BY ORDINAL_POSITION
    `);
    console.table(isc.recordset);

    printSection('7. imPersonalSectores (asignación sectores)');
    const ps = await q(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE UPPER(TABLE_NAME) = N'IMPERSONALSECTORES'
      ORDER BY ORDINAL_POSITION
    `);
    if (ps.recordset.length === 0) {
      console.log('  (tabla no encontrada en INFORMATION_SCHEMA)');
    } else {
      console.table(ps.recordset);
    }

    printSection('8. Conteos');
    const cnt = await q(`
      SELECT (SELECT COUNT(*) FROM imPassword) AS Filas_imPassword,
             (SELECT COUNT(*) FROM imPersonalSectores) AS Filas_imPersonalSectores
    `);
    console.table(cnt.recordset);

    printSection('9. Columnas IDENTITY (no enviar valor en INSERT salvo IDENTITY_INSERT ON)');
    const idents = cols.recordset.filter((c) => c.EsIdentity);
    if (idents.length === 0) {
      console.log('  (ninguna en sys.columns.is_identity para esta tabla)');
    } else {
      idents.forEach((c) => {
        console.log(`  - ${c.Columna} (${c.TipoSql}) ← NO incluir en INSERT o error 544`);
      });
    }
    const idSys = await q(`
      SELECT name AS Columna FROM sys.identity_columns WHERE object_id = ${Number(objectId)}
    `);
    if (idSys.recordset.length) {
      console.log('  sys.identity_columns confirma:', idSys.recordset.map((x) => x.Columna).join(', '));
    }

    printSection('10. Guía para el backend (crear usuario)');
    const r = cols.recordset;
    const byName = (n) => r.find((x) => String(x.Columna).toLowerCase() === n.toLowerCase());
    const vp = byName('ValorPersonal');
    const co = byName('CodOperador');
    const fa = byName('FechaActual');
    const gr = byName('Grupo');
    const nd = byName('NumeroDocumento');
    const mb = byName('MarcadeBaja');

    console.log(`
  CodOperador:
    - IDENTITY (sys.columns): ${co?.EsIdentity ? 'SÍ → omitir en INSERT; se genera solo (típico Clarion)' : 'NO → se puede enviar matrícula/código'}
    - Tipo: ${co?.TipoSql ?? '?'}

  ValorPersonal:
    - IDENTITY (sys.columns): ${vp?.EsIdentity ? 'SÍ → INSERT sin ValorPersonal + OUTPUT' : 'NO → MAX(ValorPersonal)+1 habitual'}
    - COLUMNPROPERTY: ${props.recordset[0]?.ValorPersonal_IsIdentity ?? '?'}

  FechaActual:
    - Tipo: ${fa?.TipoSql ?? '?'}
    - int/smallint → entero Clarion (días desde 1800-12-28), no GETDATE() directo.

  MarcadeBaja:
    - Tipo: ${mb?.TipoSql ?? '?'} → si es char, usar literal N'0' en SQL, no número suelto.

  NumeroDocumento / Legajo (revisar API):
    - En BD: ${nd?.TipoSql ?? '?'} / ${byName('Legajo')?.TipoSql ?? '?'} — si son int, el front no debería mandar texto no numérico.

  Grupo:
    - Existe: ${gr ? 'SÍ' : 'NO'} | Tipo: ${gr?.TipoSql ?? 'N/A'}

  imPersonalSectores:
    - idPersonal suele ser el mismo ValorPersonal que usa el join de sectores en users.service.

Ejecutá: npm run db:impassword  (o node scripts/diagnostico_impassword.js) en cada servidor nuevo.
`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      if (pool) await pool.close();
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode ?? 0);
  }
}

main();
