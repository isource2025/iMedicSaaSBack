/**
 * Prueba en seco del intercambio de camas entre pacientes: ejecuta la función real del
 * service, pero su batch de escritura corre dentro de una transacción externa que termina
 * en ROLLBACK. Verifica el resultado dentro de la transacción y confirma después que la
 * base quedó igual. No persiste nada.
 *
 * Uso: node scripts/probar_intercambio_camas.js [numeroVisita1 numeroVisita2]
 */
require('dotenv').config();
const db = require('../src/models/db');

const executeQueryOriginal = db.executeQuery;
let verificacion = null;
let batchInterceptado = false;

const SQL_VERIFICACION = `
  SELECT 'trancount' AS tipo, CAST(@@TRANCOUNT AS varchar(20)) AS sector, NULL AS cama,
         NULL AS visita, NULL AS estado, NULL AS fechaAdmision, NULL AS fechaEgreso
  UNION ALL
  SELECT 'cama', LTRIM(RTRIM(hc.ValorSector)), LTRIM(RTRIM(hc.ValorHabitacionCama)),
         CAST(hc.NumeroVisita AS varchar(20)), LTRIM(RTRIM(hc.ValorEstadoCama)), NULL, NULL
  FROM imHabitacionCamas hc
  WHERE (hc.ValorHabitacionCama = @param11 AND hc.ValorSector = @param17)
     OR (hc.ValorHabitacionCama = @param12 AND hc.ValorSector = @param18)
  UNION ALL
  SELECT 'mov', LTRIM(RTRIM(m.ValorSector)), LTRIM(RTRIM(m.ValorHabitacionCama)),
         CAST(m.NumeroVisita AS varchar(20)), LTRIM(RTRIM(m.EstadoCama)),
         CAST(m.FechaAdmision AS varchar(20)), CAST(m.FechaEgreso AS varchar(20))
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY NumeroVisita ORDER BY FechaAdmision DESC, HoraAdmision DESC) AS rn
    FROM imVisitaMovimiento
    WHERE NumeroVisita IN (@param5, @param8)
  ) m
  WHERE m.rn <= 2
  UNION ALL
  SELECT 'visita', LTRIM(RTRIM(v.ValorSector)), LTRIM(RTRIM(v.ValorHabitacionCama)),
         CAST(v.NumeroVisita AS varchar(20)), NULL, NULL, CAST(v.FechaEgreso AS varchar(20))
  FROM imVisita v
  WHERE v.NumeroVisita IN (@param5, @param8);
`;

db.executeQuery = async (consulta, parametros, opts) => {
  if (typeof consulta === 'string' && consulta.includes('Intercambio desde cama')) {
    batchInterceptado = true;
    const envuelta = `
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      ${consulta}
      ${SQL_VERIFICACION}
      ROLLBACK TRANSACTION;
    `;
    verificacion = await executeQueryOriginal(envuelta, parametros, opts);
    return [];
  }
  return executeQueryOriginal(consulta, parametros, opts);
};

const svc = require('../src/services/visitaMovimientos.service');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function elegirVisitas() {
  const rows = await executeQueryOriginal(`
    WITH ocupadas AS (
      SELECT hc.NumeroVisita, COUNT(*) AS camas
      FROM imHabitacionCamas hc
      JOIN imVisita v ON v.NumeroVisita = hc.NumeroVisita
      WHERE hc.NumeroVisita > 0
        AND ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) = 0
      GROUP BY hc.NumeroVisita
      HAVING COUNT(*) = 1
    ),
    ultimo AS (
      SELECT NumeroVisita, FechaEgreso,
             ROW_NUMBER() OVER (PARTITION BY NumeroVisita ORDER BY FechaAdmision DESC, HoraAdmision DESC) AS rn
      FROM imVisitaMovimiento
      WHERE NumeroVisita IN (SELECT NumeroVisita FROM ocupadas)
    )
    SELECT TOP 2 o.NumeroVisita
    FROM ocupadas o
    JOIN ultimo u ON u.NumeroVisita = o.NumeroVisita AND u.rn = 1
    WHERE ISNULL(TRY_CAST(u.FechaEgreso AS int), 0) = 0
    ORDER BY o.NumeroVisita DESC
  `);
  return rows.map((r) => Number(r.NumeroVisita));
}

async function foto(v1, v2) {
  const [camas, movs, visitas] = await Promise.all([
    executeQueryOriginal(
      `SELECT LTRIM(RTRIM(ValorSector)) AS s, LTRIM(RTRIM(ValorHabitacionCama)) AS c, NumeroVisita AS v,
              LTRIM(RTRIM(ValorEstadoCama)) AS e, FechaIngreso AS fi, LTRIM(RTRIM(ISNULL(Observaciones,''))) AS o
       FROM imHabitacionCamas WHERE NumeroVisita IN (@p0, @p1)
       ORDER BY NumeroVisita`,
      [{ value: v1 }, { value: v2 }],
    ),
    executeQueryOriginal(
      `SELECT NumeroVisita AS v, COUNT(*) AS n, MAX(FechaAdmision) AS maxFa,
              SUM(CASE WHEN ISNULL(TRY_CAST(FechaEgreso AS int),0) = 0 THEN 1 ELSE 0 END) AS abiertos
       FROM imVisitaMovimiento WHERE NumeroVisita IN (@p0, @p1)
       GROUP BY NumeroVisita ORDER BY NumeroVisita`,
      [{ value: v1 }, { value: v2 }],
    ),
    executeQueryOriginal(
      `SELECT NumeroVisita AS v, LTRIM(RTRIM(ValorSector)) AS s, LTRIM(RTRIM(ValorHabitacionCama)) AS c
       FROM imVisita WHERE NumeroVisita IN (@p0, @p1) ORDER BY NumeroVisita`,
      [{ value: v1 }, { value: v2 }],
    ),
  ]);
  return JSON.stringify({ camas, movs, visitas });
}

async function main() {
  let [v1, v2] = process.argv.slice(2).map(Number);
  if (!v1 || !v2) {
    [v1, v2] = await elegirVisitas();
  }
  assert(v1 && v2, 'No encontré dos visitas internadas con una sola cama y movimiento abierto');
  console.log(`\nVisitas de prueba: ${v1} y ${v2}`);

  console.log('\n== 1) Validaciones (no llegan a escribir) ==');
  await svc
    .intercambiarCamasPacientes(v1, v1, {})
    .then(() => assert(false, 'debió rechazar intercambio consigo mismo'))
    .catch((e) => {
      assert(/consigo mismo/i.test(e.message), `mensaje inesperado: ${e.message}`);
      ok('rechaza intercambiar un paciente consigo mismo');
    });
  await svc
    .intercambiarCamasPacientes(v1, v2, {})
    .then(() => assert(false, 'debió rechazar sin datos'))
    .catch((e) => {
      assert(/faltan datos/i.test(e.message), `mensaje inesperado: ${e.message}`);
      ok('rechaza si faltan fecha/hora/operador');
    });
  assert(!batchInterceptado, 'las validaciones no deberían haber llegado al batch de escritura');

  const antes = await foto(v1, v2);
  const mov1 = await executeQueryOriginal(
    `SELECT TOP 1 Operador FROM imVisitaMovimiento WHERE NumeroVisita = @p0 ORDER BY FechaAdmision DESC, HoraAdmision DESC`,
    [{ value: v1 }],
  );
  const camas = JSON.parse(antes).camas;
  const cama1 = camas.find((c) => Number(c.v) === v1);
  const cama2 = camas.find((c) => Number(c.v) === v2);
  console.log(`  Antes: ${v1} en ${cama1.s}-${cama1.c} | ${v2} en ${cama2.s}-${cama2.c}`);

  console.log('\n== 2) Intercambio real dentro de transacción con ROLLBACK ==');
  const ahora = new Date();
  const base = Date.UTC(1800, 11, 28);
  const fechaClarion = Math.round((Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()) - base) / 86400000);
  const horaClarion = (ahora.getHours() * 3600 + ahora.getMinutes() * 60 + ahora.getSeconds()) * 100 + 1;
  const res = await svc.intercambiarCamasPacientes(v1, v2, {
    FechaEgreso: fechaClarion,
    HoraEgreso: horaClarion,
    FechaAdmision: fechaClarion,
    HoraAdmision: horaClarion,
    FechaCarga: fechaClarion,
    HoraCarga: horaClarion,
    Operador: String(mov1?.[0]?.Operador ?? '0').trim() || '0',
  });
  assert(batchInterceptado, 'no se interceptó el batch de escritura');
  assert(res?.success, 'el service no devolvió success');
  ok('el batch SQL del intercambio corrió sin errores');

  const filas = verificacion || [];
  const tran = filas.find((f) => f.tipo === 'trancount');
  assert(tran && tran.sector === '1', `@@TRANCOUNT dentro de la prueba debía ser 1 (fue ${tran?.sector})`);
  ok('el COMMIT interno no confirmó nada: seguía abierta la transacción externa');

  const camaDe = (visita) => filas.filter((f) => f.tipo === 'cama' && Number(f.visita) === visita);
  const c1 = camaDe(v1);
  const c2 = camaDe(v2);
  assert(c1.length === 1 && c1[0].sector === cama2.s && c1[0].cama === cama2.c, `${v1} debía quedar en ${cama2.s}-${cama2.c}`);
  assert(c2.length === 1 && c2[0].sector === cama1.s && c2[0].cama === cama1.c, `${v2} debía quedar en ${cama1.s}-${cama1.c}`);
  assert(c1[0].estado === 'O' && c2[0].estado === 'O', 'las dos camas debían quedar ocupadas (O)');
  ok(`imHabitacionCamas: ${v1} → ${cama2.s}-${cama2.c} y ${v2} → ${cama1.s}-${cama1.c}, ambas ocupadas`);

  for (const [visita, destino] of [[v1, cama2], [v2, cama1]]) {
    const movs = filas.filter((f) => f.tipo === 'mov' && Number(f.visita) === visita);
    const [nuevo, anterior] = movs.sort((a, b) => Number(b.fechaAdmision) - Number(a.fechaAdmision));
    assert(nuevo && Number(nuevo.fechaEgreso) === 0, `el movimiento nuevo de ${visita} debía quedar abierto`);
    assert(nuevo.sector === destino.s && nuevo.cama === destino.c, `el movimiento nuevo de ${visita} debía apuntar a ${destino.s}-${destino.c}`);
    assert(anterior && Number(anterior.fechaEgreso) > 0, `el movimiento anterior de ${visita} debía quedar cerrado`);
    const vis = filas.find((f) => f.tipo === 'visita' && Number(f.visita) === visita);
    assert(vis && vis.sector === destino.s && vis.cama === destino.c, `imVisita de ${visita} debía apuntar a ${destino.s}-${destino.c}`);
  }
  ok('imVisitaMovimiento: movimiento anterior cerrado y uno nuevo abierto en la cama del otro, para los dos');
  ok('imVisita: sector y cama actualizados para los dos');

  console.log('\n== 3) Confirmar que no quedó nada escrito ==');
  const despues = await foto(v1, v2);
  assert(antes === despues, 'la base cambió después del ROLLBACK');
  ok('camas, movimientos y visitas idénticos a antes de la prueba');

  console.log('\nOK: el intercambio funciona y la prueba no dejó cambios.\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exit(1);
  });
