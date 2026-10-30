/**
 * Solo lectura: cuentas MySQL cuyo ValorPersonal no resuelve en el SQL físico
 * (mismo patrón que CASTRO 661264 @ Vidal — error IDENTIDAD_CLINICA / ID_HUERFANO).
 *
 * Detecta:
 *   A) HUERFANO: MySQL.ValorPersonal no existe en físico como imPersonal.Valor
 *      ni imPassword.ValorPersonal (la sesión no puede indicar).
 *   B) NOMBRERED_DESYNC: mismo NombreRed en MySQL y físico con ValorPersonal distinto
 *      (la ficha real suele ser la del físico).
 *
 * Uso:
 *   node scripts/audit_desync_valorpersonal_mysql_fisico.js
 *   node scripts/audit_desync_valorpersonal_mysql_fisico.js --empresas=1,101
 */
const { cargarEntorno, conectar, parsearEmpresas } = require('./lib/tenantSql');
const { getAuthCentralPool } = require('../src/config/authCentralDb');
const { normalizeEmpresaRow } = require('../src/utils/empresaDbConnection');

function normRed(v) {
	return String(v ?? '')
		.trim()
		.toLowerCase();
}

async function main() {
	cargarEntorno();
	const ids = parsearEmpresas(process.argv) ?? [];
	const mysql = await getAuthCentralPool();
	const [empRows] = await mysql.query(
		`SELECT * FROM Empresas ${ids.length ? `WHERE IDEMPRESA IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY IDEMPRESA`,
		ids,
	);
	const empresas = empRows.map(normalizeEmpresaRow);

	const hallazgos = [];
	const resumen = [];

	for (const e of empresas) {
		const idEmpresa = Number(e.IdEmpresa ?? e.IDEMPRESA);
		const desc = String(e.DESCRIPCION || e.Descripcion || '').trim();
		const label = `${idEmpresa} ${desc}`.trim();

		if (!e.DbServer || !e.DbName || !e.DbUser) {
			resumen.push({ empresa: label, mysqlCuentas: 0, huerfanos: 0, desyncNombreRed: 0, error: 'sin Db*' });
			continue;
		}

		let pool;
		try {
			const [mysqlPw] = await mysql.query(
				`SELECT ValorPersonal, CodOperador, NombreRed, Apellido, Nombres
         FROM imPassword
         WHERE IdEmpresa = ? AND ValorPersonal IS NOT NULL AND ValorPersonal > 0`,
				[idEmpresa],
			);

			pool = await conectar(e);
			const fisicoPw = (
				await pool.request().query(`
          SELECT ValorPersonal, CodOperador,
                 LTRIM(RTRIM(ISNULL(NombreRed,''))) AS NombreRed,
                 LTRIM(RTRIM(ISNULL(Apellido,''))) AS Apellido,
                 LTRIM(RTRIM(ISNULL(Nombres,''))) AS Nombres
          FROM dbo.imPassword
          WHERE ValorPersonal IS NOT NULL
        `)
			).recordset;

			const fisicoPersonal = (
				await pool.request().query(`
          SELECT Valor, Matricula,
                 LTRIM(RTRIM(ISNULL(ApellidoNombre,''))) AS ApellidoNombre
          FROM dbo.imPersonal
          WHERE Valor IS NOT NULL
        `)
			).recordset;

			const vpFisicoPw = new Set(fisicoPw.map((r) => Number(r.ValorPersonal)).filter((n) => n > 0));
			const vpFisicoPer = new Set(fisicoPersonal.map((r) => Number(r.Valor)).filter((n) => n > 0));
			const coFisico = new Set(
				fisicoPw.map((r) => Number(r.CodOperador)).filter((n) => Number.isFinite(n) && n > 0),
			);

			const fisicoByRed = new Map();
			for (const r of fisicoPw) {
				const k = normRed(r.NombreRed);
				if (!k) continue;
				if (!fisicoByRed.has(k)) fisicoByRed.set(k, []);
				fisicoByRed.get(k).push(r);
			}

			let huerfanos = 0;
			let desyncNombreRed = 0;

			for (const m of mysqlPw) {
				const vp = Number(m.ValorPersonal);
				if (!Number.isFinite(vp) || vp <= 0) continue;

				const existeComoFicha = vpFisicoPer.has(vp);
				const existeComoCuenta = vpFisicoPw.has(vp);
				const existeComoOperador = coFisico.has(vp);
				// Misma resolución que identidadClinica.resolverIdentidadProfesional
				const resuelve = existeComoFicha || existeComoCuenta || existeComoOperador;

				const red = normRed(m.NombreRed);
				const matchesFisico = red ? fisicoByRed.get(red) || [] : [];
				const vpFisicoMismoRed = matchesFisico
					.map((r) => Number(r.ValorPersonal))
					.filter((n) => Number.isFinite(n) && n > 0);

				const nombreRedDesync =
					vpFisicoMismoRed.length > 0 && !vpFisicoMismoRed.includes(vp);

				if (!resuelve) {
					huerfanos += 1;
					hallazgos.push({
						tipo: 'HUERFANO',
						empresa: idEmpresa,
						descripcion: desc,
						nombreRed: m.NombreRed,
						mysqlVP: vp,
						mysqlCO: m.CodOperador,
						apellido: m.Apellido,
						nombres: m.Nombres,
						fisicoVP_mismoNombreRed: vpFisicoMismoRed.join('|') || null,
						nota: nombreRedDesync
							? 'NombreRed existe en físico con otro ValorPersonal'
							: 'NombreRed tampoco en físico (o vacío)',
					});
				} else if (nombreRedDesync) {
					desyncNombreRed += 1;
					hallazgos.push({
						tipo: 'NOMBRERED_DESYNC',
						empresa: idEmpresa,
						descripcion: desc,
						nombreRed: m.NombreRed,
						mysqlVP: vp,
						mysqlCO: m.CodOperador,
						apellido: m.Apellido,
						nombres: m.Nombres,
						fisicoVP_mismoNombreRed: vpFisicoMismoRed.join('|'),
						nota: 'MySQL VP resuelve por CO/ficha ajena; NombreRed apunta a otra ficha',
					});
				}
			}

			resumen.push({
				empresa: label,
				mysqlCuentas: mysqlPw.length,
				huerfanos,
				desyncNombreRed,
				error: '',
			});
			console.log(
				`✓ ${label}: mysql=${mysqlPw.length} huerfanos=${huerfanos} nombreRedDesync=${desyncNombreRed}`,
			);
		} catch (err) {
			resumen.push({
				empresa: label,
				mysqlCuentas: 0,
				huerfanos: 0,
				desyncNombreRed: 0,
				error: String(err.message || err).slice(0, 80),
			});
			console.log(`✗ ${label}: ${err.message}`);
		} finally {
			await pool?.close().catch(() => {});
		}
	}

	await mysql.end().catch(() => {});

	console.log('\n=== RESUMEN ===');
	console.table(resumen);

	const criticos = hallazgos.filter((h) => h.tipo === 'HUERFANO');
	const avisos = hallazgos.filter((h) => h.tipo === 'NOMBRERED_DESYNC');

	console.log(`\n=== HUÉRFANOS (bloquean indicaciones): ${criticos.length} ===`);
	if (criticos.length) console.table(criticos);

	console.log(`\n=== NOMBRERED_DESYNC (aviso, VP aún resuelve): ${avisos.length} ===`);
	if (avisos.length) console.table(avisos);

	const totalH = criticos.length;
	process.exit(totalH > 0 ? 2 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
