/**
 * Repara Patch (Clarion) en imPedidosEstudiosAdjuntos sin tocar PatchServidor.
 *
 * Solo reescribe filas donde Clarion no puede ver el archivo (path local/IP)
 * y la conversión a \\SERVER\Imagenes\Vidal\… es inequívoca.
 *
 * Seguridad:
 *  – dry-run por defecto (no escribe)
 *  – --apply exige --id <IdAdjunto> (un solo registro)
 *  – --apply-all exige --confirm ALL (después de validar uno a uno)
 *  – nunca modifica PatchServidor
 *  – aborta si el sufijo relativo no coincide (mismo archivo)
 *  – aborta si el resultado no es UNC Clarion SERVER\Imagenes\…
 *  – solo clínicas con FileServerUrl Vidal (o --unc-root explícito)
 *
 * Uso:
 *   node scripts/reparar_patch_clarion_adjuntos.js --empresa 1 --list
 *   node scripts/reparar_patch_clarion_adjuntos.js --empresa 1 --id 12345
 *   node scripts/reparar_patch_clarion_adjuntos.js --empresa 1 --id 12345 --apply
 *   node scripts/reparar_patch_clarion_adjuntos.js --empresa 1 --apply-all --confirm ALL
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');
const {
	toClarionStoredPath,
	clarionUncRootForFileServerUrl,
	clarionUncRoot,
	relativeUnderImagenesOrRoot,
} = require('../src/utils/fileNameEncoding');

const args = process.argv.slice(2);

function flag(name) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] != null ? String(args[i + 1]) : '';
}

function has(name) {
	return args.includes(`--${name}`);
}

const EMPRESA = Number(flag('empresa') || 0);
const ID_ADJUNTO = Number(flag('id') || 0);
const APPLY = has('apply');
const APPLY_ALL = has('apply-all');
const CONFIRM_ALL = String(flag('confirm') || '') === 'ALL';
const LIST = has('list');
const UNC_ROOT_OVERRIDE = String(flag('unc-root') || '').trim();
const LIMIT = Math.min(Math.max(Number(flag('limit') || 50) || 50, 1), 500);

function normRel(p) {
	return String(p || '')
		.replace(/\//g, '\\')
		.replace(/^\\+/, '')
		.replace(/\\+/g, '\\')
		.trim()
		.toLowerCase();
}

function isClarionServerUnc(p) {
	return /^\\\\SERVER\\Imagenes\\[^\\]+(\\|$)/i.test(String(p || '').replace(/\//g, '\\'));
}

function isIpUnc(p) {
	return /^\\\\(\d{1,3}\.){3}\d{1,3}\\/i.test(String(p || '').replace(/\//g, '\\'));
}

function isLocalDrivePath(p) {
	return /^[A-Za-z]:\\/.test(String(p || '').replace(/\//g, '\\'));
}

/** Path físico típico de subida SaaS (nunca Clarion F:\Descargas / \\192.168). */
function isSaasDiskPath(p) {
	const s = String(p || '').replace(/\//g, '\\');
	return (
		/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\/i.test(s) ||
		/^[A-Za-z]:\\imagenes\\vidal\\/i.test(s)
	);
}

function needsClarionRepair(patch, uncRoot) {
	const p = String(patch || '').replace(/\//g, '\\').trim();
	if (!p) return { ok: false, reason: 'Patch vacío' };
	if (isClarionServerUnc(p)) return { ok: false, reason: 'Patch ya es UNC Clarion \\SERVER\\…' };
	// SOLO candidatos SaaS: path físico de clínica (adjuntos / imagenes\vidal).
	// Nunca tocar F:\Descargas, D:\Escritorio, \\192.168\… (Clarion legacy).
	if (/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\/i.test(p)) {
		return { ok: true, reason: 'SaaS local adjuntos' };
	}
	if (/^[A-Za-z]:\\imagenes\\vidal\\/i.test(p)) {
		return { ok: true, reason: 'SaaS local imagenes\\vidal' };
	}
	return { ok: false, reason: 'no es path SaaS (Clarion/legacy — no tocar)' };
}

/**
 * Plan de reparación para una fila. Devuelve { action: 'update'|'skip', ... }.
 * Invariante: mismo archivo (sufijo relativo) y destino Clarion inequívoco.
 */
function planRepair(row, uncRoot) {
	const id = Number(row.IdAdjunto);
	const patch = String(row.Patch || '').replace(/\//g, '\\').trim();
	const patchServidor = String(row.PatchServidor || '').replace(/\//g, '\\').trim();

	const need = needsClarionRepair(patch, uncRoot);
	if (!need.ok) {
		return { action: 'skip', id, reason: need.reason, patch, patchServidor };
	}

	// Fuente de verdad del archivo en disco = PatchServidor SaaS, o Patch si ya es SaaS.
	const source = patchServidor || patch;
	if (!isSaasDiskPath(source) && !isSaasDiskPath(patch)) {
		return {
			action: 'skip',
			id,
			reason: 'ni Patch ni PatchServidor son path SaaS de clínica',
			patch,
			patchServidor,
		};
	}

	const expected = String(
		toClarionStoredPath(source, { personales: false, uncRoot }),
	)
		.replace(/\//g, '\\')
		.trim();

	if (!expected) {
		return { action: 'skip', id, reason: 'conversión vacía', patch, patchServidor, source };
	}
	if (!isClarionServerUnc(expected)) {
		return {
			action: 'skip',
			id,
			reason: `resultado no es UNC Clarion SERVER: ${expected}`,
			patch,
			patchServidor,
			source,
			expected,
		};
	}

	const relSource = normRel(relativeUnderImagenesOrRoot(source) || source);
	const relExpected = normRel(relativeUnderImagenesOrRoot(expected) || expected);
	if (!relSource || !relExpected) {
		return {
			action: 'skip',
			id,
			reason: 'no se pudo extraer sufijo relativo',
			patch,
			patchServidor,
			source,
			expected,
			relSource,
			relExpected,
		};
	}
	if (relSource !== relExpected) {
		return {
			action: 'skip',
			id,
			reason: `sufijo relativo no coincide (source≠expected): "${relSource}" vs "${relExpected}"`,
			patch,
			patchServidor,
			source,
			expected,
			relSource,
			relExpected,
		};
	}

	// Si PatchServidor existe, el relativo de Patch nuevo debe coincidir también con él
	if (patchServidor) {
		const relSrv = normRel(relativeUnderImagenesOrRoot(patchServidor) || patchServidor);
		if (relSrv && relSrv !== relExpected) {
			return {
				action: 'skip',
				id,
				reason: `no coincide con PatchServidor: "${relSrv}" vs "${relExpected}"`,
				patch,
				patchServidor,
				source,
				expected,
			};
		}
	}

	if (normRel(patch) === normRel(expected)) {
		return { action: 'skip', id, reason: 'Patch ya igual al esperado', patch, expected };
	}

	// Evitar degradar un path que ya tiene más información que el esperado
	if (isClarionServerUnc(patch) && patch.length > expected.length) {
		return {
			action: 'skip',
			id,
			reason: 'Patch Clarion actual parece más específico; no tocar',
			patch,
			expected,
		};
	}

	return {
		action: 'update',
		id,
		reason: need.reason,
		numeroVisita: row.NumeroVisita,
		descripcion: row.Descripcion,
		patch,
		patchServidor,
		source,
		expected,
		relSource,
		relExpected,
	};
}

function printPlan(plan) {
	console.log(`\n── IdAdjunto ${plan.id} (visita ${plan.numeroVisita ?? '?'}) ──`);
	console.log(`  acción:     ${plan.action}`);
	console.log(`  motivo:     ${plan.reason}`);
	if (plan.descripcion) console.log(`  archivo:    ${plan.descripcion}`);
	console.log(`  Patch:      ${plan.patch || '(vacío)'}`);
	console.log(`  PatchServ:  ${plan.patchServidor || '(vacío)'}`);
	if (plan.expected) console.log(`  → Clarion:  ${plan.expected}`);
	if (plan.relExpected) console.log(`  relativo:   ${plan.relExpected}`);
}

async function connectEmpresa(empresaId) {
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [er] = await mp.query(`SELECT * FROM Empresas WHERE IDEMPRESA=?`, [empresaId]);
	if (!er?.[0]) {
		await mp.end();
		throw new Error(`Empresa ${empresaId} no encontrada`);
	}
	const emp = normalizeEmpresaRow(er[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	const fileServerUrl = String(emp.FileServerUrl || emp.fileServerUrl || '').trim();
	const pool = await sql.connect({
		server: String(emp.DbServer || emp.dbServer).trim(),
		port: Number(emp.DbPort || emp.dbPort) || 1433,
		database: String(emp.DbName || emp.dbName).trim(),
		user: String(emp.DbUser || emp.dbUser).trim(),
		password,
		options: { encrypt: false, trustServerCertificate: true },
	});
	return { mp, pool, emp, fileServerUrl };
}

async function main() {
	if (!EMPRESA || !Number.isFinite(EMPRESA) || EMPRESA <= 0) {
		console.error('Falta --empresa <id>');
		console.error(
			'Ej: node scripts/reparar_patch_clarion_adjuntos.js --empresa 1 --id 12345',
		);
		process.exit(1);
	}
	if (APPLY && APPLY_ALL) {
		console.error('Usá --apply (un id) o --apply-all, no ambos');
		process.exit(1);
	}
	if (APPLY && !(ID_ADJUNTO > 0)) {
		console.error('--apply requiere --id <IdAdjunto> (un solo registro)');
		process.exit(1);
	}
	if (APPLY_ALL && !CONFIRM_ALL) {
		console.error('--apply-all requiere --confirm ALL');
		process.exit(1);
	}

	const mode = APPLY || APPLY_ALL ? 'APPLY (escribe Patch)' : 'DRY-RUN (solo lectura)';
	console.log(`MODE: ${mode}`);
	console.log(`Empresa: ${EMPRESA}`);

	const { mp, pool, emp, fileServerUrl } = await connectEmpresa(EMPRESA);
	const uncRoot =
		UNC_ROOT_OVERRIDE.replace(/\//g, '\\').replace(/[\\/]+$/, '') ||
		clarionUncRootForFileServerUrl(fileServerUrl) ||
		'';

	console.log(`Descripción: ${emp.DESCRIPCION || emp.descripcion || ''}`);
	console.log(`FileServerUrl: ${fileServerUrl || '(vacío)'}`);
	console.log(`UNC Clarion: ${uncRoot || '(ninguno — abortar si hace falta Vidal)'}`);

	if (!uncRoot) {
		console.error(
			'\nEsta empresa no tiene UNC Clarion (no es Vidal / sin --unc-root).\n' +
				'No se reescribe nada: en Sarmiento el path local en Patch puede ser correcto.',
		);
		await pool.close();
		await mp.end();
		process.exit(2);
	}

	if (!/vidal/i.test(fileServerUrl) && !UNC_ROOT_OVERRIDE && !/vidal/i.test(String(uncRoot))) {
		console.error('\nUNC root no parece Vidal. Pasá --unc-root explícito para continuar.');
		await pool.close();
		await mp.end();
		process.exit(2);
	}

	const req = pool.request();
	let rows;
	if (ID_ADJUNTO > 0) {
		req.input('id', sql.Int, ID_ADJUNTO);
		rows = (
			await req.query(`
				SELECT IdAdjunto, NumeroVisita, Descripcion, Patch, PatchServidor, Fecha
				FROM dbo.imPedidosEstudiosAdjuntos
				WHERE IdAdjunto = @id
			`)
		).recordset;
		if (!rows.length) {
			console.error(`No existe IdAdjunto=${ID_ADJUNTO}`);
			await pool.close();
			await mp.end();
			process.exit(1);
		}
	} else if (!APPLY_ALL) {
		rows = (
			await pool.request().query(`
				SELECT TOP (${LIMIT})
					IdAdjunto, NumeroVisita, Descripcion, Patch, PatchServidor, Fecha
				FROM dbo.imPedidosEstudiosAdjuntos
				WHERE LTRIM(RTRIM(ISNULL(Patch, ''))) <> ''
				  AND Patch NOT LIKE '\\\\SERVER\\Imagenes\\%'
				  AND Patch NOT LIKE '\\\\server\\Imagenes\\%'
				  AND (
				    Patch LIKE '[A-Z]:\\adjuntos\\%'
				    OR Patch LIKE '[A-Z]:\\imedic\\adjuntos\\%'
				    OR Patch LIKE '[A-Z]:\\imagenes\\vidal\\%'
				    OR PatchServidor LIKE '[A-Z]:\\adjuntos\\%'
				    OR PatchServidor LIKE '[A-Z]:\\imedic\\adjuntos\\%'
				    OR PatchServidor LIKE '[A-Z]:\\imagenes\\vidal\\%'
				  )
				ORDER BY IdAdjunto DESC
			`)
		).recordset;
	}

	async function applyOne(p) {
		const check = await pool
			.request()
			.input('id', sql.Int, p.id)
			.query(`
				SELECT IdAdjunto, NumeroVisita, Descripcion, Patch, PatchServidor, Fecha
				FROM dbo.imPedidosEstudiosAdjuntos
				WHERE IdAdjunto = @id
			`);
		const live = check.recordset[0];
		if (!live) return { ok: false, msg: `FAIL ${p.id}: desapareció` };
		const livePlan = planRepair(live, uncRoot);
		if (livePlan.action !== 'update') {
			return { ok: false, msg: `FAIL ${p.id}: ya no es update (${livePlan.reason})` };
		}
		if (normRel(livePlan.expected) !== normRel(p.expected)) {
			return {
				ok: false,
				msg: `FAIL ${p.id}: expected cambió (${p.expected} → ${livePlan.expected})`,
			};
		}
		if (normRel(live.Patch) !== normRel(p.patch)) {
			return { ok: false, msg: `FAIL ${p.id}: Patch cambió desde el plan; no tocar` };
		}

		const result = await pool
			.request()
			.input('id', sql.Int, p.id)
			.input('oldPatch', sql.NVarChar(600), p.patch)
			.input('newPatch', sql.NVarChar(600), livePlan.expected)
			.query(`
				UPDATE dbo.imPedidosEstudiosAdjuntos
				SET Patch = @newPatch
				WHERE IdAdjunto = @id
				  AND Patch = @oldPatch
			`);
		const affected = result.rowsAffected?.[0] || 0;
		if (affected !== 1) {
			return { ok: false, msg: `FAIL ${p.id}: UPDATE afectó ${affected} filas (esperado 1)` };
		}

		const verify = await pool
			.request()
			.input('id', sql.Int, p.id)
			.query(`
				SELECT Patch, PatchServidor
				FROM dbo.imPedidosEstudiosAdjuntos
				WHERE IdAdjunto = @id
			`);
		const v = verify.recordset[0];
		if (normRel(v.Patch) !== normRel(livePlan.expected)) {
			return { ok: false, msg: `FAIL ${p.id}: verificación post-UPDATE falló` };
		}
		if (normRel(v.PatchServidor || '') !== normRel(p.patchServidor || '')) {
			return { ok: false, msg: `FAIL ${p.id}: PatchServidor cambió (no debería)` };
		}
		return { ok: true, msg: `OK ${p.id}: ${p.patch} → ${livePlan.expected}` };
	}

	if (APPLY_ALL) {
		const BATCH = Math.min(Math.max(Number(flag('batch') || 200) || 200, 10), 500);
		let cursor = 2147483647;
		let totalOk = 0;
		let totalFail = 0;
		let totalSkip = 0;
		let batchNo = 0;

		console.log(`\nMasivo por lotes de ${BATCH} (solo Patch ≠ \\\\SERVER\\Imagenes\\…)…`);

		while (true) {
			batchNo += 1;
			const batch = (
				await pool
					.request()
					.input('cursor', sql.Int, cursor)
					.input('batch', sql.Int, BATCH)
					.query(`
						SELECT TOP (@batch)
							IdAdjunto, NumeroVisita, Descripcion, Patch, PatchServidor, Fecha
						FROM dbo.imPedidosEstudiosAdjuntos
						WHERE IdAdjunto < @cursor
						  AND LTRIM(RTRIM(ISNULL(Patch, ''))) <> ''
						  AND LTRIM(RTRIM(ISNULL(PatchServidor, ''))) <> ''
						  AND Patch NOT LIKE '\\\\SERVER\\Imagenes\\%'
						  AND Patch NOT LIKE '\\\\server\\Imagenes\\%'
						  AND (
						    Patch LIKE '[A-Z]:\\adjuntos\\%'
						    OR Patch LIKE '[A-Z]:\\imedic\\adjuntos\\%'
						    OR Patch LIKE '[A-Z]:\\imagenes\\vidal\\%'
						    OR PatchServidor LIKE '[A-Z]:\\adjuntos\\%'
						    OR PatchServidor LIKE '[A-Z]:\\imedic\\adjuntos\\%'
						    OR PatchServidor LIKE '[A-Z]:\\imagenes\\vidal\\%'
						  )
						ORDER BY IdAdjunto DESC
					`)
			).recordset;

			if (!batch.length) break;

			const plans = batch.map((r) => planRepair(r, uncRoot));
			const updates = plans.filter((p) => p.action === 'update');
			totalSkip += plans.length - updates.length;
			cursor = Math.min(...batch.map((r) => Number(r.IdAdjunto)));

			console.log(
				`\nLote ${batchNo}: leídas ${batch.length}, update ${updates.length}, skip ${plans.length - updates.length} (cursor→${cursor})`,
			);

			for (const p of updates) {
				const r = await applyOne(p);
				if (r.ok) {
					totalOk += 1;
					if (totalOk <= 20 || totalOk % 100 === 0) console.log(`  ${r.msg}`);
				} else {
					totalFail += 1;
					console.error(`  ${r.msg}`);
				}
			}
		}

		console.log(
			`\nMasivo listo: OK=${totalOk} FAIL=${totalFail} SKIP=${totalSkip} lotes=${batchNo}`,
		);
		await pool.close();
		await mp.end();
		return;
	}

	const plans = rows.map((r) => planRepair(r, uncRoot));
	const updates = plans.filter((p) => p.action === 'update');
	const skips = plans.filter((p) => p.action === 'skip');

	console.log(`\nFilas leídas: ${rows.length}`);
	console.log(`Candidatas a update: ${updates.length}`);
	console.log(`Omitidas: ${skips.length}`);

	if (LIST || ID_ADJUNTO > 0 || !APPLY) {
		for (const p of ID_ADJUNTO > 0 ? plans : updates.slice(0, 30)) {
			printPlan(p);
		}
		if (!ID_ADJUNTO && updates.length > 30) {
			console.log(`\n… ${updates.length - 30} candidatas más (subí --limit o usá --id)`);
		}
	}

	if (!APPLY) {
		console.log(
			'\nDry-run OK. Para corregir UNO:\n' +
				`  node scripts/reparar_patch_clarion_adjuntos.js --empresa ${EMPRESA} --id <IdAdjunto> --apply`,
		);
		await pool.close();
		await mp.end();
		return;
	}

	const toWrite = updates.filter((p) => p.id === ID_ADJUNTO);
	if (toWrite.length !== 1) {
		console.error(
			`\nAbortado: --apply con --id ${ID_ADJUNTO} no produjo exactamente 1 update (obtuvo ${toWrite.length}).`,
		);
		if (plans[0]) printPlan(plans[0]);
		await pool.close();
		await mp.end();
		process.exit(1);
	}

	console.log(`\nEscribiendo ${toWrite.length} fila(s)…`);
	let ok = 0;
	for (const p of toWrite) {
		const r = await applyOne(p);
		console.log(`  ${r.msg}`);
		if (r.ok) ok += 1;
	}

	console.log(`\nListo: ${ok}/${toWrite.length} actualizados.`);
	if (ok === 1) {
		console.log(
			'\nVerificá en Clarion que ve el archivo. Si OK, recién ahí:\n' +
				`  node scripts/reparar_patch_clarion_adjuntos.js --empresa ${EMPRESA} --apply-all --confirm ALL`,
		);
	}

	await pool.close();
	await mp.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
