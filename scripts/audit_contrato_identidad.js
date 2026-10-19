#!/usr/bin/env node
/**
 * Mide filas recientes contra el contrato (solo lectura).
 * Uso: node scripts/audit_contrato_identidad.js --empresas=1,100 --dias=7
 */
const { cargarEntorno, conectar, parsearEmpresas } = require('./lib/tenantSql');

const CHECKS = [
	{
		columna: 'imInterCtrlFrecuente.Profesional',
		sql: `SELECT COUNT(*) n FROM dbo.imInterCtrlFrecuente c
		      WHERE c.FechaCarga > @desde AND ISNULL(c.Profesional, 0) > 0
		        AND c.Profesional = c.OperadorCarga
		        AND NOT EXISTS (SELECT 1 FROM dbo.imPersonal p WHERE p.Valor = c.Profesional)`,
	},
];

(async () => {
	cargarEntorno();
	const { getAuthCentralPool } = require('../src/config/authCentralDb');
	const { normalizeEmpresaRow } = require('../src/utils/empresaDbConnection');
	const my = await getAuthCentralPool();
	const ids = parsearEmpresas(process.argv) ?? [];
	const dias = Number((process.argv.find((a) => a.startsWith('--dias=')) || '--dias=7').slice(7));
	const [emps] = await my.query(
		`SELECT * FROM Empresas ${ids.length ? `WHERE IDEMPRESA IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY IDEMPRESA`,
		ids,
	);
	const desdeClarion = Math.floor(Date.now() / 86400000) + 36161 - dias;
	const filas = [];
	for (const e of emps.map(normalizeEmpresaRow)) {
		const id = Number(e.IdEmpresa ?? e.IDEMPRESA);
		const pool = await conectar(e);
		try {
			for (const c of CHECKS) {
				const r = await pool
					.request()
					.input('desde', desdeClarion)
					.query(c.sql);
				filas.push({ empresa: id, columna: c.columna, fueraDeContrato: Number(r.recordset[0]?.n || 0) });
			}
		} finally {
			await pool.close();
		}
	}
	console.table(filas);
	process.exit(filas.some((f) => f.fueraDeContrato > 0) ? 2 : 0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
