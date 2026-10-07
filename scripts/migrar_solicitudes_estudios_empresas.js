/**
 * Esquema de solicitudes de estudios agrupadas (imSolicitudesEstudios + imPedidosEstudios.IdSolicitud)
 * en la base SQL Server de cada empresa, con la conexión guardada en la plataforma.
 * Idempotente y solo aditivo (mismo DDL que solicitudesEstudios.service / scripts/sql/solicitudes_estudios_multi.sql).
 *
 *   node scripts/migrar_solicitudes_estudios_empresas.js --env-file .env.railway.local            (solo estado)
 *   node scripts/migrar_solicitudes_estudios_empresas.js --env-file .env.railway.local --aplicar
 *   node scripts/migrar_solicitudes_estudios_empresas.js --env-file .env.railway.local --aplicar 3
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
const args = process.argv.slice(2).filter((a, i, all) => a !== '--env-file' && all[i - 1] !== '--env-file');
const aplicar = args.includes('--aplicar');
const only = Number(args.find((a) => /^\d+$/.test(a)) || 0);

process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_HOST || process.env.MYSQLHOST ? '1' : '0';

const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');
const { runWithTenant } = require('../src/context/tenantContext');
const svc = require('../src/services/solicitudesEstudios.service');

const TIMEOUT_MS = 60000;

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

async function main() {
	if (!isAuthCentralEnabled()) {
		console.error('Sin AUTH_DB_* en el entorno: usar --env-file .env.railway.local');
		process.exit(1);
	}
	const mysql = await getAuthCentralPool();
	const [list] = await mysql.query('SELECT IDEMPRESA, DESCRIPCION FROM `Empresas` ORDER BY IDEMPRESA');
	const empresas = (list || [])
		.map((r) => ({ id: Number(campo(r, 'IDEMPRESA')), nombre: String(campo(r, 'DESCRIPCION') || '').trim() }))
		.filter((e) => Number.isFinite(e.id) && e.id > 0 && (!only || e.id === only));

	console.log(aplicar ? '== APLICANDO esquema ==' : '== Solo estado (usar --aplicar para migrar) ==');
	const resumen = [];
	for (const emp of empresas) {
		const fila = { id: emp.id, empresa: emp.nombre, base: '', antes: '', despues: '', error: '' };
		try {
			await conTimeout(
				runWithTenant(emp.id, async () => {
					const st = await svc.estadoEsquema();
					fila.base = st.baseDatos;
					fila.antes = st.completo ? 'ok' : st.tablaPedidos ? 'FALTA' : 'sin imPedidosEstudios';
					if (aplicar && st.tablaPedidos && !st.completo) {
						const r = await svc.aplicarEsquema();
						fila.despues = r.despues.completo ? 'ok' : 'INCOMPLETO';
					}
				}),
				TIMEOUT_MS,
			);
		} catch (e) {
			fila.error = String(e?.message || e).slice(0, 120);
		}
		resumen.push(fila);
		console.log(JSON.stringify(fila));
	}
	console.table(resumen);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
