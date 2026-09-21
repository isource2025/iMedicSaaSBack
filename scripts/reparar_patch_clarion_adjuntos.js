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

function needsClarionRepair(patch, uncRoot) {
	const p = String(patch || '').replace(/\//g, '\\').trim();
	if (!p) return { ok: false, reason: 'Patch vacío' };
	if (isClarionServerUnc(p)) return { ok: false, reason: 'Patch ya es UNC Clarion \\SERVER\\…' };
	if (isLocalDrivePath(p) || isIpUnc(p)) return { ok: true, reason: 'path local o UNC con IP' };
	// Relativa sin root Clarion: Clarion Vidal no la resuelve sola
	if (uncRoot && !p.startsWith('\\\\')) {
		return { ok: true, reason: 'path relativa sin UNC Clarion' };
	}
	return { ok: false, reason: 'formato no candidato' };
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

	// Fuente de verdad del archivo en disco = PatchServidor (SaaS). Fallback Patch.
	const source = patchServidor || patch;
	if (!source) {
		return { action: 'skip', id, reason: 'sin Patch ni PatchServidor', patch, patchServidor };
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
	} else {
		rows = (
			await pool.request().query(`
				SELECT TOP (${LIMIT})
					IdAdjunto, NumeroVisita, Descripcion, Patch, PatchServidor, Fecha
				FROM dbo.imPedidosEstudiosAdjuntos
				ORDER BY Fecha DESC
			`)
		).recordset;
	}

	const plans = rows.map((r) => planRepair(r, uncRoot));
	const updates = plans.filter((p) => p.action === 'update');
	const skips = plans.filter((p) => p.action === 'skip');

	console.log(`\nFilas leídas: ${rows.length}`);
	console.log(`Candidatas a update: ${updates.length}`);
	console.log(`Omitidas: ${skips.length}`);

	if (LIST || ID_ADJUNTO > 0 || !APPLY_ALL) {
		for (const p of ID_ADJUNTO > 0 ? plans : updates.slice(0, 30)) {
			printPlan(p);
		}
		if (!ID_ADJUNTO && updates.length > 30) {
			console.log(`\n… ${updates.length - 30} candidatas más (subí --limit o usá --id)`);
		}
	}

	if (!APPLY && !APPLY_ALL) {
		console.log(
			'\nDry-run OK. Para corregir UNO:\n' +
				`  node scripts/reparar_patch_clarion_adjuntos.js --empresa ${EMPRESA} --id <IdAdjunto> --apply`,
		);
		await pool.close();
		await mp.end();
		return;
	}

	const toWrite = APPLY ? updates.filter((p) => p.id === ID_ADJUNTO) : updates;
	if (APPLY && toWrite.length !== 1) {
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
		// Re-leer y re-validar justo antes de UPDATE (evita race / cambio manual)
		const check = await pool
			.request()
			.input('id', sql.Int, p.id)
			.query(`
				SELECT IdAdjunto, NumeroVisita, Descripcion, Patch, PatchServidor, Fecha
				FROM dbo.imPedidosEstudiosAdjuntos
				WHERE IdAdjunto = @id
			`);
		const live = check.recordset[0];
		if (!live) {
			console.error(`  FAIL ${p.id}: desapareció`);
			continue;
		}
		const livePlan = planRepair(live, uncRoot);
		if (livePlan.action !== 'update') {
			console.error(`  FAIL ${p.id}: ya no es update (${livePlan.reason})`);
			continue;
		}
		if (normRel(livePlan.expected) !== normRel(p.expected)) {
			console.error(
				`  FAIL ${p.id}: expected cambió (${p.expected} → ${livePlan.expected})`,
			);
			continue;
		}
		if (normRel(live.Patch) !== normRel(p.patch)) {
			console.error(`  FAIL ${p.id}: Patch cambió desde el plan; no tocar`);
			continue;
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
			console.error(`  FAIL ${p.id}: UPDATE afectó ${affected} filas (esperado 1)`);
			continue;
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
			console.error(`  FAIL ${p.id}: verificación post-UPDATE falló`);
			continue;
		}
		if (normRel(v.PatchServidor || '') !== normRel(p.patchServidor || '')) {
			console.error(`  FAIL ${p.id}: PatchServidor cambió (no debería)`);
			continue;
		}

		ok += 1;
		console.log(`  OK ${p.id}: ${p.patch} → ${livePlan.expected}`);
	}

	console.log(`\nListo: ${ok}/${toWrite.length} actualizados.`);
	if (APPLY && ok === 1) {
		console.log(
			'\nVerificá en Clarion que ve el archivo. Si OK, recién ahí:\n' +
				`  node scripts/reparar_patch_clarion_adjuntos.js --empresa ${EMPRESA} --list\n` +
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
