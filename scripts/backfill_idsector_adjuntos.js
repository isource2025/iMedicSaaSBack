/**
 * Rellena IdSector vacío en adjuntos SaaS (Clarion lo muestra en la columna Sector).
 *
 *   node scripts/backfill_idsector_adjuntos.js --empresa 1 --dry-run
 *   node scripts/backfill_idsector_adjuntos.js --empresa 1 --apply
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EMPRESA = Number(
	(() => {
		const i = args.indexOf('--empresa');
		return i >= 0 ? args[i + 1] : 1;
	})(),
);

function mapTipo(tipo) {
	const t = String(tipo || '').trim().toUpperCase();
	if (!t) return null;
	if (t === 'RAD' || t.startsWith('RX')) return 'RAY';
	if (t === 'TOM' || t.startsWith('TOMO')) return 'TOM';
	if (t === 'LABH' || t === 'HEMA' || t.startsWith('HEMATO')) return 'HEMA';
	if (t === 'HEMO') return 'HEMO';
	if (t.startsWith('LAB')) return 'LAB';
	if (t === 'GAS') return 'GAS';
	if (t === 'NEU' || t === 'NEUM') return 'NEU';
	if (t === 'ANE' || t === 'ANEST') return 'QUIR';
	return null;
}

function normSec(v) {
	const s = String(v || '').trim();
	return s ? s.slice(0, 4) : null;
}

(async () => {
	console.log(APPLY ? 'MODE: APPLY' : 'MODE: DRY-RUN');
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [er] = await mp.query('SELECT * FROM Empresas WHERE IDEMPRESA=?', [EMPRESA]);
	const emp = normalizeEmpresaRow(er[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	const pool = await sql.connect({
		server: String(emp.DbServer).trim(),
		port: Number(emp.DbPort) || 1433,
		database: String(emp.DbName).trim(),
		user: String(emp.DbUser).trim(),
		password,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 120000,
	});

	const rows = (
		await pool.request().query(`
      SELECT a.IdAdjunto, a.NumeroVisita, a.IdOperador,
             LTRIM(RTRIM(a.IdTipoImagen)) AS Tipo,
             LTRIM(RTRIM(CAST(v.VALORSECTOR AS VARCHAR(20)))) AS SectorVisita
      FROM dbo.imPedidosEstudiosAdjuntos a
      LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = a.NumeroVisita
      WHERE (a.IdSector IS NULL OR LTRIM(RTRIM(a.IdSector)) = '')
        AND (
          a.PatchServidor LIKE 'E:\\adjuntos\\%'
          OR a.PatchServidor LIKE 'C:\\imedic\\adjuntos\\%'
          OR a.PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
        )
      ORDER BY a.IdAdjunto DESC
    `)
	).recordset;

	console.log(`Candidatas sin IdSector: ${rows.length}`);

	const plans = [];
	for (const r of rows) {
		let sector = mapTipo(r.Tipo);
		let motivo = sector ? `tipo ${r.Tipo}→${sector}` : null;
		if (!sector) {
			sector = normSec(r.SectorVisita);
			motivo = sector ? `visita ${r.SectorVisita}` : null;
		}
		if (!sector && r.IdOperador) {
			const secRows = (
				await pool
					.request()
					.input('op', sql.Int, Number(r.IdOperador))
					.query(`
            SELECT TOP 1 LTRIM(RTRIM(ps.idSector)) AS idSector
            FROM dbo.imPersonalSectores ps
            WHERE LTRIM(RTRIM(ps.idSector)) <> ''
              AND (
                ps.idPersonal = @op
                OR ps.idPersonal IN (
                  SELECT pw.ValorPersonal FROM dbo.imPassword pw
                  WHERE pw.CodOperador = @op AND pw.ValorPersonal IS NOT NULL
                )
              )
          `)
			).recordset;
			sector = normSec(secRows?.[0]?.idSector);
			motivo = sector ? `operador ${r.IdOperador}` : null;
		}
		if (sector) {
			plans.push({ id: r.IdAdjunto, sector, motivo, tipo: r.Tipo, visita: r.NumeroVisita });
		}
	}

	console.log(`Con sector resuelto: ${plans.length}`);
	for (const p of plans.slice(0, 15)) {
		console.log(`  ${p.id} visita ${p.visita} tipo=${p.tipo} → ${p.sector} (${p.motivo})`);
	}

	if (!APPLY) {
		console.log('\nDry-run OK. Repetí con --apply');
		await pool.close();
		await mp.end();
		return;
	}

	let ok = 0;
	for (const p of plans) {
		const r = await pool
			.request()
			.input('id', sql.Int, p.id)
			.input('sec', sql.VarChar(4), p.sector)
			.query(`
        UPDATE dbo.imPedidosEstudiosAdjuntos
        SET IdSector = @sec
        WHERE IdAdjunto = @id
          AND (IdSector IS NULL OR LTRIM(RTRIM(IdSector)) = '')
      `);
		if ((r.rowsAffected?.[0] || 0) === 1) ok += 1;
	}
	console.log(`\nActualizados: ${ok}/${plans.length}`);

	const check = await pool.request().query(`
    SELECT IdAdjunto, IdTipoImagen, IdSector
    FROM imPedidosEstudiosAdjuntos
    WHERE IdAdjunto IN (149636,149747,152865,161472)
  `);
	console.table(check.recordset);

	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
