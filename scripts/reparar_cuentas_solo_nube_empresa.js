/**
 * Repara cuentas MySQL sin ficha física para una empresa (tenant).
 *
 * Uso:
 *   node scripts/reparar_cuentas_solo_nube_empresa.js --empresa=100
 *   node scripts/reparar_cuentas_solo_nube_empresa.js --empresa=100 --dnis=22319265,22960712
 *   node scripts/reparar_cuentas_solo_nube_empresa.js --empresa=100 --dry-run
 */
const { cargarEntorno } = require('./lib/tenantSql');
const { runWithTenant } = require('../src/context/tenantContext');
const { getAuthCentralPool } = require('../src/config/authCentralDb');

async function main() {
	cargarEntorno();
	const arg = process.argv.find((a) => a.startsWith('--empresa='));
	const emp = arg ? Number(arg.split('=')[1]) : NaN;
	const dryRun = process.argv.includes('--dry-run');
	const dnisArg = process.argv.find((a) => a.startsWith('--dnis='));
	const dnis = dnisArg
		? new Set(
				dnisArg
					.split('=')[1]
					.split(',')
					.map((s) => String(s.trim()))
					.filter(Boolean),
			)
		: null;
	if (!Number.isFinite(emp) || emp <= 0) {
		console.error(
			'Uso: node scripts/reparar_cuentas_solo_nube_empresa.js --empresa=100 [--dnis=22319265,22960712] [--dry-run]',
		);
		process.exit(1);
	}

	const personalService = require('../src/services/personal.service');

	await runWithTenant(emp, async () => {
		let pendientes = await personalService.listarCuentasSoloNube();
		if (dnis) {
			pendientes = pendientes.filter((c) => {
				const doc = c.numeroDocumento != null ? String(c.numeroDocumento) : '';
				const user = c.nombreRed != null ? String(c.nombreRed).trim() : '';
				return dnis.has(doc) || dnis.has(user);
			});
		}
		console.log(`Empresa ${emp}: ${pendientes.length} cuenta(s) a procesar`);
		for (const c of pendientes) {
			console.log(
				`  - VP ${c.valor} | ${c.apellidoNombre} | user=${c.nombreRed} | dni=${c.numeroDocumento} | ${c.sugerencia}${c.valorDestino != null ? `→${c.valorDestino}` : ''}`,
			);
		}
		if (dryRun) {
			console.log('Dry-run: no se aplicaron cambios.');
			return;
		}
		if (!pendientes.length) return;

		if (!dnis) {
			const result = await personalService.repararCuentasSoloNube();
			console.log('\nReparados:', result.reparados.length);
			for (const r of result.reparados) {
				console.log(
					`  OK ${r.accion || 'reparado'} | ${r.apellidoNombre} | user=${r.nombreRed} | →${r.valor}${r.valorOrigen ? ` (desde ${r.valorOrigen})` : ''}`,
				);
			}
			console.log('Errores:', result.errores.length);
			for (const r of result.errores) {
				console.log(`  ERR VP ${r.valor} | ${r.apellidoNombre}: ${r.error}`);
			}
			return;
		}

		const mysql = await getAuthCentralPool();
		const reparados = [];
		const errores = [];
		for (const c of pendientes) {
			const [rows] = await mysql.query(
				`SELECT * FROM imPassword WHERE IdEmpresa = ? AND ValorPersonal = ? LIMIT 1`,
				[emp, c.valor],
			);
			const row = rows?.[0];
			if (!row) {
				errores.push({
					valor: c.valor,
					nombreRed: c.nombreRed,
					apellidoNombre: c.apellidoNombre,
					error: 'no está en MySQL imPassword',
				});
				continue;
			}
			try {
				const r = await personalService.repararUnaCuentaSoloNube(row, emp);
				if (r.accion === 'omitido_sistema' || r.accion === 'ya_existia') continue;
				reparados.push({
					valor: r.valor,
					valorOrigen: r.valorOrigen ?? null,
					accion: r.accion,
					nombreRed: c.nombreRed,
					apellidoNombre: r.apellidoNombre || c.apellidoNombre,
				});
			} catch (err) {
				errores.push({
					valor: c.valor,
					nombreRed: c.nombreRed,
					apellidoNombre: c.apellidoNombre,
					error: String(err.message || err).slice(0, 240),
				});
			}
		}

		console.log('\nReparados:', reparados.length);
		for (const r of reparados) {
			console.log(
				`  OK ${r.accion || 'reparado'} | ${r.apellidoNombre} | user=${r.nombreRed} | →${r.valor}${r.valorOrigen ? ` (desde ${r.valorOrigen})` : ''}`,
			);
		}
		console.log('Errores:', errores.length);
		for (const r of errores) {
			console.log(`  ERR VP ${r.valor} | ${r.apellidoNombre || ''}: ${r.error}`);
		}
	});
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
