/**
 * Restaura el autor (ProfesionalAsiste) de las indicaciones reindicadas.
 *
 * La reindicación web grababa como profesional al usuario que copiaba (p. ej. adminsarmiento
 * → "ADMIN") en vez del médico que escribió la indicación. Cada copia apunta a la anterior
 * por NroIndicacionAnterior; se recorre la cadena hasta la original (NroIndicacionAnterior = 0),
 * o hasta la última copia anterior a --desde, y se le asigna su ProfesionalAsiste. También corrige la fila de imInterCtrlDieta que se
 * graba al crear una dieta (sin FechaDieta), no los controles de enfermería.
 *
 * Cada empresa se corrige en una sola transacción que verifica, antes de confirmar, que solo
 * cambió lo pedido; si algo no coincide hace ROLLBACK. Con --aplicar guarda antes un respaldo
 * JSON en scripts/backups/.
 *
 *   node scripts/migrar_autor_reindicaciones.js --env-file .env.railway.local               (solo informe, todas)
 *   node scripts/migrar_autor_reindicaciones.js --env-file .env.railway.local 101           (solo informe, Sarmiento)
 *   node scripts/migrar_autor_reindicaciones.js --env-file .env.railway.local 101 --probar  (aplica, verifica y ROLLBACK)
 *   node scripts/migrar_autor_reindicaciones.js --env-file .env.railway.local 101 --aplicar
 *   node scripts/migrar_autor_reindicaciones.js ... --visita 588                            (una internación)
 *   node scripts/migrar_autor_reindicaciones.js ... --desde 2026-06-15                      (fecha de carga mínima de la copia)
 *   node scripts/migrar_autor_reindicaciones.js ... 101 --revertir scripts/backups/x.json --probar|--aplicar
 *     (devuelve cada fila del respaldo al profesional que tenía antes de la migración)
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envIdx = process.argv.indexOf('--env-file');
const envFile =
	envIdx >= 0 && process.argv[envIdx + 1] ? path.resolve(process.cwd(), process.argv[envIdx + 1]) : null;
if (envFile) {
	if (!fs.existsSync(envFile)) {
		console.error('No existe', envFile);
		process.exit(1);
	}
	dotenv.config({ path: envFile, override: true });
} else {
	dotenv.config();
}
const valorDe = (flag) => {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const conValor = new Set(['--env-file', '--visita', '--desde', '--revertir']);
const archivoRevertir = valorDe('--revertir');
const args = process.argv.slice(2).filter((a, i, all) => !conValor.has(a) && !conValor.has(all[i - 1]));
const aplicar = args.includes('--aplicar');
const probar = !aplicar && args.includes('--probar');
const only = Number(args.find((a) => /^\d+$/.test(a)) || 0);
const visita = Number(valorDe('--visita') || 0);
// Antes de esta fecha la reindicación web conservaba el autor; las copias más viejas son del
// sistema de escritorio, donde el médico que reindica firma la indicación.
const desde = valorDe('--desde') || '2026-06-15';
if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
	console.error('--desde debe ser YYYY-MM-DD');
	process.exit(1);
}

process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_HOST || process.env.MYSQLHOST ? '1' : '0';

const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');
const { runWithTenant } = require('../src/context/tenantContext');
const { executeQuery } = require('../src/models/db');

const TIMEOUT_MS = 300000;
const LOTE = 400;

function conTimeout(promise, ms) {
	let t;
	return Promise.race([
		promise,
		new Promise((_, rej) => {
			t = setTimeout(() => rej(new Error(`timeout ${ms} ms`)), ms);
		}),
	]).finally(() => clearTimeout(t));
}

function campo(row, name) {
	const k = Object.keys(row || {}).find((x) => x.toLowerCase() === name.toLowerCase());
	return k ? row[k] : undefined;
}

/** Copias cuyo ProfesionalAsiste no coincide con el de la indicación original de su cadena. */
const SQL_PENDIENTES = `
;WITH cadena AS (
  SELECT r.NroIndicacion, r.NroIndicacion AS Raiz, r.ProfesionalAsiste AS ProfRaiz, 0 AS Nivel
  FROM dbo.imInterIndMedicas r
  WHERE ISNULL(r.NroIndicacionAnterior, 0) = 0
    AND EXISTS (SELECT 1 FROM dbo.imInterIndMedicas h WHERE h.NroIndicacionAnterior = r.NroIndicacion)
    AND (@param0 = 0 OR r.NumeroVisita = @param0)
  UNION ALL
  SELECT h.NroIndicacion,
    CASE WHEN h.FechaCarga < DATEDIFF(day, '1800-12-28', @param1) THEN h.NroIndicacion ELSE c.Raiz END,
    CASE WHEN h.FechaCarga < DATEDIFF(day, '1800-12-28', @param1) THEN h.ProfesionalAsiste ELSE c.ProfRaiz END,
    c.Nivel + 1
  FROM dbo.imInterIndMedicas h
  JOIN cadena c ON h.NroIndicacionAnterior = c.NroIndicacion
  WHERE h.NroIndicacion <> h.NroIndicacionAnterior AND c.Nivel < 1000
)
SELECT i.NroIndicacion, i.NumeroVisita,
  CONVERT(varchar(10), DATEADD(day, i.FechaCarga, '1800-12-28'), 23) AS Fecha,
  i.OperadorCarga, i.ProfesionalAsiste AS ProfActual, c.ProfRaiz, c.Raiz
FROM cadena c
JOIN dbo.imInterIndMedicas i ON i.NroIndicacion = c.NroIndicacion
WHERE c.Nivel > 0
  AND i.FechaCarga >= DATEDIFF(day, '1800-12-28', @param1)
  AND ISNULL(c.ProfRaiz, 0) > 0
  AND ISNULL(i.ProfesionalAsiste, 0) <> c.ProfRaiz
ORDER BY i.NumeroVisita, i.FechaCarga, i.NroIndicacion
OPTION (MAXRECURSION 1000)
`;

function nombresPersonal(rows) {
	const ids = [...new Set(rows.flatMap((r) => [r.ProfActual, r.ProfRaiz]).map(Number))].filter(
		(n) => Number.isFinite(n) && n > 0,
	);
	if (!ids.length) return Promise.resolve(new Map());
	return executeQuery(
		`SELECT Valor, Matricula, LTRIM(RTRIM(ApellidoNombre)) AS Nombre FROM dbo.imPersonal
     WHERE Valor IN (${ids.join(',')}) OR Matricula IN (${ids.join(',')})`,
	).then((per) => {
		const m = new Map();
		for (const p of per) {
			if (!m.has(Number(p.Valor))) m.set(Number(p.Valor), p.Nombre);
		}
		for (const p of per) {
			if (p.Matricula != null && !m.has(Number(p.Matricula))) m.set(Number(p.Matricula), p.Nombre);
		}
		return m;
	});
}

/** Columnas comparables con EXCEPT, sin la que se corrige. */
async function columnasComparables(tabla, excluida) {
	const rows = await executeQuery(
		`SELECT name FROM sys.columns
     WHERE object_id = OBJECT_ID(@param0) AND name <> @param1
       AND TYPE_NAME(system_type_id) NOT IN ('text', 'ntext', 'image', 'xml', 'timestamp', 'sql_variant')
     ORDER BY column_id`,
		[{ value: tabla }, { value: excluida }],
	);
	return rows.map((r) => `[${String(r.name).replace(/]/g, ']]')}]`).join(', ');
}

/**
 * Corrige todas las filas de la empresa en una sola transacción y verifica, antes de confirmar,
 * que cambió exactamente lo pedido: cantidad de filas, profesional nuevo, resto de columnas de
 * esas filas intacto y el resto de ambas tablas sin cambios (conteo + checksum).
 * Si alguna verificación falla, o si confirmar = false, hace ROLLBACK.
 */
async function corregirEmpresa(rows, confirmar) {
	const colsInd = await columnasComparables('dbo.imInterIndMedicas', 'ProfesionalAsiste');
	const colsDieta = await columnasComparables('dbo.imInterCtrlDieta', 'Profesional');
	const inserts = [];
	for (let i = 0; i < rows.length; i += LOTE) {
		const valores = rows
			.slice(i, i + LOTE)
			.map((r) => `(${Number(r.NroIndicacion)}, ${Number(r.ProfActual) || 0}, ${Number(r.ProfRaiz)})`)
			.join(',');
		inserts.push(`INSERT INTO @fix VALUES ${valores};`);
	}
	const res = await executeQuery(`
SET XACT_ABORT ON;
SET NOCOUNT ON;
DECLARE @fix TABLE (NroIndicacion int PRIMARY KEY, ProfViejo int, ProfNuevo int);
${inserts.join('\n')}
DECLARE @dfix TABLE (Valor int, ProfViejo int, ProfNuevo int);

BEGIN TRAN;

INSERT INTO @dfix (Valor, ProfViejo, ProfNuevo)
SELECT d.Valor, ISNULL(d.Profesional, 0), f.ProfNuevo
FROM dbo.imInterCtrlDieta d
JOIN @fix f ON f.NroIndicacion = d.Nroindicacion
JOIN dbo.imInterIndMedicas i ON i.NroIndicacion = f.NroIndicacion
WHERE ISNULL(d.FechaDieta, 0) = 0
  AND d.FechaCarga = i.FechaCarga
  AND ISNULL(d.Profesional, 0) = f.ProfViejo;

SELECT ${colsInd} INTO #indAntes FROM dbo.imInterIndMedicas WHERE NroIndicacion IN (SELECT NroIndicacion FROM @fix);
SELECT ${colsDieta} INTO #dietaAntes FROM dbo.imInterCtrlDieta WHERE Valor IN (SELECT Valor FROM @dfix);

DECLARE @nIndOtras int, @cIndOtras int, @nDietaOtras int, @cDietaOtras int;
SELECT @nIndOtras = COUNT(*), @cIndOtras = CHECKSUM_AGG(BINARY_CHECKSUM(*))
FROM dbo.imInterIndMedicas i WHERE NOT EXISTS (SELECT 1 FROM @fix f WHERE f.NroIndicacion = i.NroIndicacion);
SELECT @nDietaOtras = COUNT(*), @cDietaOtras = CHECKSUM_AGG(BINARY_CHECKSUM(*))
FROM dbo.imInterCtrlDieta d WHERE NOT EXISTS (SELECT 1 FROM @dfix x WHERE x.Valor = d.Valor);

UPDATE d SET d.Profesional = x.ProfNuevo
FROM dbo.imInterCtrlDieta d JOIN @dfix x ON x.Valor = d.Valor
WHERE ISNULL(d.Profesional, 0) = x.ProfViejo;
DECLARE @dietas int = @@ROWCOUNT;

UPDATE i SET i.ProfesionalAsiste = f.ProfNuevo
FROM dbo.imInterIndMedicas i JOIN @fix f ON f.NroIndicacion = i.NroIndicacion
WHERE ISNULL(i.ProfesionalAsiste, 0) = f.ProfViejo;
DECLARE @indicaciones int = @@ROWCOUNT;

DECLARE @esperadasInd int = (SELECT COUNT(*) FROM @fix);
DECLARE @esperadasDieta int = (SELECT COUNT(*) FROM @dfix);

DECLARE @okCantidad bit = CASE WHEN @indicaciones = @esperadasInd AND @dietas = @esperadasDieta THEN 1 ELSE 0 END;
DECLARE @okProfesional bit = CASE WHEN NOT EXISTS (
    SELECT 1 FROM dbo.imInterIndMedicas i JOIN @fix f ON f.NroIndicacion = i.NroIndicacion
    WHERE ISNULL(i.ProfesionalAsiste, 0) <> f.ProfNuevo)
  AND NOT EXISTS (
    SELECT 1 FROM dbo.imInterCtrlDieta d JOIN @dfix x ON x.Valor = d.Valor
    WHERE ISNULL(d.Profesional, 0) <> x.ProfNuevo) THEN 1 ELSE 0 END;
DECLARE @okOtrasColumnas bit = CASE WHEN NOT EXISTS (
    SELECT ${colsInd} FROM #indAntes
    EXCEPT SELECT ${colsInd} FROM dbo.imInterIndMedicas WHERE NroIndicacion IN (SELECT NroIndicacion FROM @fix))
  AND NOT EXISTS (
    SELECT ${colsDieta} FROM #dietaAntes
    EXCEPT SELECT ${colsDieta} FROM dbo.imInterCtrlDieta WHERE Valor IN (SELECT Valor FROM @dfix)) THEN 1 ELSE 0 END;

DECLARE @nIndOtras2 int, @cIndOtras2 int, @nDietaOtras2 int, @cDietaOtras2 int;
SELECT @nIndOtras2 = COUNT(*), @cIndOtras2 = CHECKSUM_AGG(BINARY_CHECKSUM(*))
FROM dbo.imInterIndMedicas i WHERE NOT EXISTS (SELECT 1 FROM @fix f WHERE f.NroIndicacion = i.NroIndicacion);
SELECT @nDietaOtras2 = COUNT(*), @cDietaOtras2 = CHECKSUM_AGG(BINARY_CHECKSUM(*))
FROM dbo.imInterCtrlDieta d WHERE NOT EXISTS (SELECT 1 FROM @dfix x WHERE x.Valor = d.Valor);
DECLARE @okResto bit = CASE WHEN @nIndOtras = @nIndOtras2 AND ISNULL(@cIndOtras, 0) = ISNULL(@cIndOtras2, 0)
  AND @nDietaOtras = @nDietaOtras2 AND ISNULL(@cDietaOtras, 0) = ISNULL(@cDietaOtras2, 0) THEN 1 ELSE 0 END;

DECLARE @ok bit = CASE WHEN @okCantidad = 1 AND @okProfesional = 1 AND @okOtrasColumnas = 1 AND @okResto = 1 THEN 1 ELSE 0 END;
IF @ok = 1 AND @param0 = 1 COMMIT; ELSE ROLLBACK;

SELECT @ok AS Ok, CASE WHEN @ok = 1 AND @param0 = 1 THEN 'COMMIT' ELSE 'ROLLBACK' END AS Resultado,
  @esperadasInd AS IndEsperadas, @indicaciones AS IndCambiadas,
  @esperadasDieta AS DietaEsperadas, @dietas AS DietaCambiadas,
  @okCantidad AS OkCantidad, @okProfesional AS OkProfesional, @okOtrasColumnas AS OkOtrasColumnas,
  @okResto AS OkRestoTablas, @nIndOtras AS IndRestoFilas, @nDietaOtras AS DietaRestoFilas;
`, [{ value: confirmar ? 1 : 0, type: 'Int' }]);
	return res?.[0] || null;
}

async function revertir() {
	if (!only) {
		console.error('--revertir requiere el número de empresa del respaldo');
		process.exit(1);
	}
	const respaldo = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), archivoRevertir), 'utf8'));
	// corregirEmpresa pasa de ProfActual a ProfRaiz: se invierten para volver al valor previo.
	const rows = respaldo.map((r) => ({
		NroIndicacion: r.NroIndicacion,
		ProfActual: r.ProfRaiz,
		ProfRaiz: Number(r.ProfActual) || 0,
	}));
	console.log(
		aplicar ? '== REVIRTIENDO (COMMIT solo si la verificación pasa) ==' : '== PRUEBA DE REVERSIÓN (ROLLBACK) ==',
		`empresa ${only}, ${rows.length} indicaciones`,
	);
	const r = await conTimeout(runWithTenant(only, () => corregirEmpresa(rows, aplicar)), TIMEOUT_MS);
	console.table([r]);
	process.exit(r?.Ok ? 0 : 1);
}

async function main() {
	if (!isAuthCentralEnabled()) {
		console.error('Sin AUTH_DB_* en el entorno: usar --env-file .env.railway.local');
		process.exit(1);
	}
	if (archivoRevertir) {
		await revertir();
		return;
	}
	const mysql = await getAuthCentralPool();
	const [list] = await mysql.query(
		'SELECT IDEMPRESA, DESCRIPCION, DbServer FROM `Empresas` ORDER BY IDEMPRESA',
	);
	const empresas = (list || [])
		.map((r) => ({
			id: Number(campo(r, 'IDEMPRESA')),
			nombre: String(campo(r, 'DESCRIPCION') || '').trim(),
			server: campo(r, 'DbServer'),
		}))
		.filter((e) => Number.isFinite(e.id) && e.id > 0 && e.server && (!only || e.id === only));

	console.log(
		aplicar
			? '== APLICANDO (COMMIT solo si la verificación pasa) =='
			: probar
				? '== PRUEBA: aplica, verifica y hace ROLLBACK =='
				: '== Solo informe (usar --probar o --aplicar) ==',
		`copias desde ${desde}`,
	);
	const backupDir = path.join(__dirname, 'backups');
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const resumen = [];

	for (const emp of empresas) {
		const fila = {
			id: emp.id,
			empresa: emp.nombre,
			pendientes: 0,
			internaciones: 0,
			resultado: '',
			corregidas: 0,
			dietas: 0,
			quedanPendientes: '',
			error: '',
		};
		try {
			await conTimeout(
				runWithTenant(emp.id, async () => {
					const rows = await executeQuery(SQL_PENDIENTES, [
						{ value: visita, type: 'Int' },
						{ value: desde },
					]);
					fila.pendientes = rows.length;
					fila.internaciones = new Set(rows.map((r) => r.NumeroVisita)).size;
					if (!rows.length) return;

					const nombres = await nombresPersonal(rows);
					const porCambio = new Map();
					for (const r of rows) {
						const k = `${r.ProfActual} ${nombres.get(Number(r.ProfActual)) || '?'}  ->  ${r.ProfRaiz} ${nombres.get(Number(r.ProfRaiz)) || '?'}`;
						porCambio.set(k, (porCambio.get(k) || 0) + 1);
					}
					console.log(`\n[${emp.id}] ${emp.nombre}: ${rows.length} indicaciones en ${fila.internaciones} internaciones`);
					console.table([...porCambio].map(([cambio, cantidad]) => ({ cambio, cantidad })).sort((a, b) => b.cantidad - a.cantidad));
					const porMes = new Map();
					for (const r of rows) {
						const k = `${String(r.Fecha).slice(0, 7)}  operador ${r.OperadorCarga}`;
						porMes.set(k, (porMes.get(k) || 0) + 1);
					}
					console.table([...porMes].sort().map(([mesOperador, cantidad]) => ({ mesOperador, cantidad })));

					if (!aplicar && !probar) return;
					if (aplicar) {
						fs.mkdirSync(backupDir, { recursive: true });
						const archivo = path.join(backupDir, `autor_reindicaciones_${emp.id}_${stamp}.json`);
						fs.writeFileSync(archivo, JSON.stringify(rows, null, 2));
						console.log('Respaldo:', archivo);
					}
					const r = await corregirEmpresa(rows, aplicar);
					console.log(`Verificación [${emp.id}]:`);
					console.table([r]);
					fila.resultado = r?.Resultado || 'SIN RESPUESTA';
					if (!r?.Ok) {
						fila.error = 'Verificación fallida: no se cambió nada';
						return;
					}
					if (aplicar) {
						fila.corregidas = Number(r.IndCambiadas) || 0;
						fila.dietas = Number(r.DietaCambiadas) || 0;
						const quedan = await executeQuery(SQL_PENDIENTES, [
							{ value: visita, type: 'Int' },
							{ value: desde },
						]);
						fila.quedanPendientes = quedan.length;
					}
				}),
				TIMEOUT_MS,
			);
		} catch (e) {
			fila.error = String(e?.message || e).slice(0, 120);
		}
		resumen.push(fila);
	}
	console.table(resumen);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
