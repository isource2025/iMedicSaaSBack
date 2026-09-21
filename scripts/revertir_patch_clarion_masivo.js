/**
 * Revierte Patch cambiados por el masivo ERRÓNEO (archivos Clarion / no-SaaS).
 * Conserva solo reparaciones de subidas SaaS (PatchServidor en disco local adjuntos/imagenes).
 *
 * Fuente de paths viejos: log del terminal del apply-all.
 *
 *   node scripts/revertir_patch_clarion_masivo.js --empresa 1 --log "ruta\\al\\316504.txt" --dry-run
 *   node scripts/revertir_patch_clarion_masivo.js --empresa 1 --log "ruta\\al\\316504.txt" --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const args = process.argv.slice(2);
function flag(name) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] != null ? String(args[i + 1]) : '';
}
function has(name) {
	return args.includes(`--${name}`);
}

const EMPRESA = Number(flag('empresa') || 1);
const APPLY = has('apply');
const LOG_PATH = flag('log');

/** Paths viejos que SÍ son de la plataforma SaaS (no revertir). */
function isSaasOldPatch(oldPatch) {
	const p = String(oldPatch || '').replace(/\//g, '\\');
	if (/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\/i.test(p)) return true;
	if (/^[A-Za-z]:\\imagenes\\vidal\\/i.test(p)) return true;
	if (/^[A-Za-z]:\\imagenes\\/i.test(p) && /\\vidal\\/i.test(p)) return true;
	return false;
}

/** PatchServidor típico SaaS (disco físico clínica). */
function isSaasPatchServidor(ps) {
	const p = String(ps || '').replace(/\//g, '\\');
	if (/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\/i.test(p)) return true;
	if (/^[A-Za-z]:\\imagenes\\vidal\\/i.test(p)) return true;
	return false;
}

function parseLog(text) {
	const out = [];
	// OK 166818: D:\Escritorio\...\file.pdf → \\SERVER\Imagenes\Vidal\...
	const re = /^\s*OK\s+(\d+):\s+(.+?)\s+→\s+(.+)\s*$/gm;
	let m;
	while ((m = re.exec(text))) {
		out.push({
			id: Number(m[1]),
			oldPatch: m[2].trim(),
			newPatch: m[3].trim(),
		});
	}
	return out;
}

function parseLoteCursors(text) {
	const cursors = [];
	const re = /Lote\s+(\d+):.*?cursor→(\d+)/g;
	let m;
	while ((m = re.exec(text))) {
		cursors.push({ lote: Number(m[1]), cursor: Number(m[2]) });
	}
	return cursors;
}

async function main() {
	if (!LOG_PATH || !fs.existsSync(LOG_PATH)) {
		console.error('Falta --log <archivo terminal del masivo>');
		process.exit(1);
	}

	const text = fs.readFileSync(LOG_PATH, 'utf8');
	const parsed = parseLog(text);
	const cursors = parseLoteCursors(text);
	const minCursor = cursors.length ? Math.min(...cursors.map((c) => c.cursor)) : null;

	console.log(APPLY ? 'MODE: APPLY (revertir)' : 'MODE: DRY-RUN');
	console.log(`Log: ${LOG_PATH}`);
	console.log(`OK parseados del log: ${parsed.length}`);
	console.log(`Lotes vistos: ${cursors.length}, cursor mínimo: ${minCursor}`);

	const toRevert = parsed.filter((p) => !isSaasOldPatch(p.oldPatch));
	const keepSaas = parsed.filter((p) => isSaasOldPatch(p.oldPatch));
	console.log(`A revertir (no-SaaS, con path viejo en log): ${toRevert.length}`);
	console.log(`Conservar (SaaS, path viejo SaaS): ${keepSaas.length}`);

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
	});

	// Rango tocado por el masivo: desde el primer id del lote 1 hasta el cursor final
	// (aprox IdAdjunto >= minCursor, y <= max id in log / 166819)
	const maxId = parsed.length ? Math.max(...parsed.map((p) => p.id), 166819) : 166819;

	const rangeRows = (
		await pool
			.request()
			.input('minId', sql.Int, minCursor || 0)
			.input('maxId', sql.Int, maxId)
			.query(`
				SELECT IdAdjunto, Patch, PatchServidor
				FROM dbo.imPedidosEstudiosAdjuntos
				WHERE IdAdjunto >= @minId AND IdAdjunto <= @maxId
				  AND (
				    Patch LIKE '\\\\SERVER\\Imagenes\\%'
				    OR Patch LIKE '\\\\server\\Imagenes\\%'
				  )
			`)
	).recordset;

	const saasInRange = rangeRows.filter((r) => isSaasPatchServidor(r.PatchServidor));
	const clarionInRange = rangeRows.filter((r) => !isSaasPatchServidor(r.PatchServidor));
	const withOldInLog = new Set(toRevert.map((p) => p.id));
	const clarionSinLog = clarionInRange.filter((r) => !withOldInLog.has(Number(r.IdAdjunto)));

	console.log(`\nEn rango IdAdjunto ${minCursor}..${maxId} con Patch Clarion UNC:`);
	console.log(`  total: ${rangeRows.length}`);
	console.log(`  SaaS (PatchServidor disco local) — NO tocar: ${saasInRange.length}`);
	console.log(`  Clarion/otros — a revertir si hay path viejo: ${clarionInRange.length}`);
	console.log(`  Clarion SIN path viejo en log (problema): ${clarionSinLog.length}`);

	if (!APPLY) {
		console.log('\nEjemplos a revertir (con log):');
		for (const p of toRevert.slice(0, 10)) {
			console.log(`  ${p.id}: ${p.newPatch} → ${p.oldPatch}`);
		}
		if (clarionSinLog.length) {
			console.log(
				`\n⚠ ${clarionSinLog.length} filas Clarion cambiadas sin path viejo en el log.`,
			);
			console.log('  El log solo imprimió ~1 de cada 100. Esas no se pueden restaurar exactas');
			console.log('  sin backup SQL. Ids ejemplo:', clarionSinLog.slice(0, 5).map((r) => r.IdAdjunto));
		}
		console.log('\nSi OK: repetí con --apply');
		await pool.close();
		await mp.end();
		return;
	}

	let ok = 0;
	let fail = 0;
	for (const p of toRevert) {
		const live = (
			await pool
				.request()
				.input('id', sql.Int, p.id)
				.query(`SELECT Patch, PatchServidor FROM dbo.imPedidosEstudiosAdjuntos WHERE IdAdjunto=@id`)
		).recordset[0];
		if (!live) {
			console.error(`FAIL ${p.id}: no existe`);
			fail += 1;
			continue;
		}
		// Solo revertir si Patch sigue siendo el "new" (o equivalente SERVER)
		const cur = String(live.Patch || '').replace(/\//g, '\\');
		const expectedNew = String(p.newPatch || '').replace(/\//g, '\\');
		const norm = (s) => s.replace(/^\\\\server\\/i, '\\\\SERVER\\');
		if (norm(cur).toLowerCase() !== norm(expectedNew).toLowerCase()) {
			// ya no está en el new path — skip
			continue;
		}
		if (isSaasPatchServidor(live.PatchServidor)) {
			console.log(`SKIP ${p.id}: PatchServidor es SaaS, no revertir`);
			continue;
		}

		const result = await pool
			.request()
			.input('id', sql.Int, p.id)
			.input('oldNew', sql.NVarChar(600), live.Patch)
			.input('restore', sql.NVarChar(600), p.oldPatch)
			.query(`
				UPDATE dbo.imPedidosEstudiosAdjuntos
				SET Patch = @restore
				WHERE IdAdjunto = @id AND Patch = @oldNew
			`);
		if ((result.rowsAffected?.[0] || 0) !== 1) {
			console.error(`FAIL ${p.id}: update ${result.rowsAffected}`);
			fail += 1;
			continue;
		}
		ok += 1;
		if (ok <= 15 || ok % 50 === 0) {
			console.log(`REVERTIDO ${p.id}: ${p.newPatch} → ${p.oldPatch}`);
		}
	}

	console.log(`\nRevertidos con log: OK=${ok} FAIL=${fail}`);
	console.log(
		`Pendientes sin path viejo: ${clarionSinLog.length} (hace falta backup SQL o otro log completo)`,
	);

	await pool.close();
	await mp.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
