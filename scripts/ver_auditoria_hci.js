#!/usr/bin/env node
/**
 * Lee (solo lectura) el historial de dbo.imHCIAuditoria: quién tocó qué HC,
 * desde dónde y qué valor tenía antes cada campo.
 *
 *   node scripts/ver_auditoria_hci.js --empresa=1 --hc=190394
 *   node scripts/ver_auditoria_hci.js --empresa=1 --visita=466607
 *   node scripts/ver_auditoria_hci.js --empresa=1 --dias=7            # actividad reciente
 *   node scripts/ver_auditoria_hci.js --empresa=1 --dias=7 --solo-borrados
 *   node scripts/ver_auditoria_hci.js --empresa=1 --lote=<guid> --revertir
 *
 * --revertir imprime el SQL para deshacer ese lote. No ejecuta nada: hay que
 * leerlo y correrlo a mano.
 */
const { cargarEntorno, obtenerEmpresas, conectar } = require('./lib/tenantSql');
const { TABLA_AUDITORIA: TABLA } = require('../src/utils/auditoriaHci');

cargarEntorno();

const argv = process.argv.slice(2);
const valor = (nombre) => {
	const arg = argv.find((a) => a.startsWith(`--${nombre}=`));
	return arg ? arg.split('=').slice(1).join('=') : null;
};
const EMPRESA = Number(valor('empresa') || 1);
const HC = valor('hc') ? Number(valor('hc')) : null;
const VISITA = valor('visita') ? Number(valor('visita')) : null;
const DIAS = valor('dias') ? Number(valor('dias')) : null;
const LOTE = valor('lote');
const REVERTIR = argv.includes('--revertir');
const SOLO_BORRADOS = argv.includes('--solo-borrados');
const ANCHO = Number(valor('ancho') || 70);

const ACCIONES = { I: 'ALTA', U: 'MODIFICA', D: 'BORRA', E: 'ERROR-AUDIT' };

const recortar = (v) => {
	if (v === null) return '(null)';
	const s = String(v).replace(/\r?\n/g, '⏎');
	return s.length > ANCHO ? `${s.slice(0, ANCHO - 1)}…` : s;
};
const fecha = (d) =>
	d instanceof Date ? d.toISOString().slice(0, 19).replace('T', ' ') : String(d);
const literal = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

async function traerFilas(pool) {
	const req = pool.request();
	const condiciones = [];

	if (LOTE) {
		condiciones.push('Lote = @lote');
		req.input('lote', LOTE);
	}
	if (HC != null) {
		condiciones.push('IdHCIngreso = @hc');
		req.input('hc', HC);
	}
	if (VISITA != null) {
		condiciones.push('NumeroVisita = @visita');
		req.input('visita', VISITA);
	}
	if (DIAS != null) {
		condiciones.push('FechaHora >= DATEADD(day, -@dias, SYSDATETIME())');
		req.input('dias', DIAS);
	}
	if (SOLO_BORRADOS) condiciones.push(`Accion = 'D'`);
	if (condiciones.length === 0) {
		throw new Error('indicá al menos --hc, --visita, --dias o --lote');
	}

	return (
		await req.query(`
			SELECT IdHCIngreso, NumeroVisita, Accion, FechaHora, Lote, Origen, Usuario,
			       IdOperador, LoginSql, Aplicacion, Host, Columna, ValorAnterior, ValorNuevo
			FROM dbo.${TABLA}
			WHERE ${condiciones.join(' AND ')}
			ORDER BY FechaHora, Lote, Columna
		`)
	).recordset;
}

/** Agrupa por lote: un lote = una sentencia = un "guardado". */
function agrupar(filas) {
	const lotes = new Map();
	for (const f of filas) {
		const clave = `${f.Lote}|${f.IdHCIngreso}`;
		if (!lotes.has(clave)) lotes.set(clave, { cabecera: f, campos: [] });
		if (f.Columna !== null) lotes.get(clave).campos.push(f);
	}
	return [...lotes.values()];
}

function imprimir(lotes) {
	for (const { cabecera: c, campos } of lotes) {
		const quien =
			c.Origen === 'WEB'
				? `${c.Usuario || '?'}${c.IdOperador ? ` (cod ${c.IdOperador})` : ''}`
				: `${c.LoginSql} vía ${c.Aplicacion || '?'}`;
		console.log(
			`\n${fecha(c.FechaHora)}  ${(ACCIONES[c.Accion] || c.Accion).padEnd(11)} ` +
				`HC ${c.IdHCIngreso} (visita ${c.NumeroVisita ?? '?'})  ${c.Origen}: ${quien}  @${c.Host || '?'}`,
		);
		console.log(`  lote ${c.Lote}  ${campos.length} campo(s)`);
		for (const f of campos) {
			if (c.Accion === 'D') console.log(`    ${f.Columna.padEnd(30)} ${recortar(f.ValorAnterior)}`);
			else {
				console.log(
					`    ${f.Columna.padEnd(30)} ${recortar(f.ValorAnterior)}\n    ${' '.repeat(30)} → ${recortar(f.ValorNuevo)}`,
				);
			}
		}
	}
}

/** SQL para deshacer un lote. No se ejecuta: se imprime para revisar. */
function imprimirReversion(lotes) {
	for (const { cabecera: c, campos } of lotes) {
		if (campos.length === 0) {
			console.log(`\n-- lote ${c.Lote}: sin campos guardados, nada que revertir`);
			continue;
		}

		console.log(`\n-- ${ACCIONES[c.Accion]} de ${fecha(c.FechaHora)} por ${c.Usuario || c.LoginSql}`);
		if (c.Accion === 'U') {
			const sets = campos.map((f) => `    [${f.Columna}] = ${literal(f.ValorAnterior)}`);
			console.log(`UPDATE dbo.imHCI SET\n${sets.join(',\n')}\nWHERE IdHCIngreso = ${c.IdHCIngreso};`);
		} else if (c.Accion === 'D') {
			const cols = campos.map((f) => `[${f.Columna}]`);
			const vals = campos.map((f) => literal(f.ValorAnterior));
			console.log(`SET IDENTITY_INSERT dbo.imHCI ON;`);
			console.log(
				`INSERT INTO dbo.imHCI ([IdHCIngreso], ${cols.join(', ')})\nVALUES (${c.IdHCIngreso}, ${vals.join(', ')});`,
			);
			console.log(`SET IDENTITY_INSERT dbo.imHCI OFF;`);
		} else {
			console.log(`-- acción ${c.Accion}: no aplica reversión`);
		}
	}
	console.log('\n-- Revisá el SQL antes de correrlo. Reponer campos vacíos también es un cambio.');
}

(async () => {
	const [empresa] = await obtenerEmpresas([EMPRESA]);
	if (!empresa) throw new Error(`empresa ${EMPRESA} no encontrada`);

	const pool = await conectar(empresa);
	try {
		const existe = (
			await pool.request().query(`SELECT OBJECT_ID('dbo.${TABLA}', 'U') AS id`)
		).recordset[0].id;
		if (!existe) {
			throw new Error(
				`${empresa.DESCRIPCION} no tiene la auditoría instalada. Corré: node scripts/instalar_auditoria_hci.js --empresas=${EMPRESA}`,
			);
		}

		const filas = await traerFilas(pool);
		console.log(`=== ${empresa.DESCRIPCION} (empresa ${EMPRESA}) / ${TABLA} ===`);
		if (filas.length === 0) {
			console.log('Sin movimientos registrados para ese filtro.');
			return;
		}

		const lotes = agrupar(filas);
		console.log(`${lotes.length} movimiento(s), ${filas.length} fila(s) de historial.`);
		if (REVERTIR) imprimirReversion(lotes);
		else imprimir(lotes);
	} finally {
		await pool.close();
	}
	process.exit(0);
})().catch((e) => {
	console.error('✗', e.message);
	process.exit(2);
});
