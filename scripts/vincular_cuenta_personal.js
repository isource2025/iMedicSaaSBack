/**
 * Vincula cuentas de login (impassword) sin ficha (ValorPersonal NULL/0) con su ficha de
 * imPersonal buscando por DNI. Sin vínculo el login emite un token sin id y todo responde 401.
 *
 * Correr en el servidor del backend (usa la BD del .env: DB_SERVER/DB_NAME):
 *   node scripts/vincular_cuenta_personal.js 30216938            # diagnóstico (no escribe)
 *   node scripts/vincular_cuenta_personal.js 30216938 --apply    # aplica
 *   node scripts/vincular_cuenta_personal.js --todos             # lista todas las cuentas sin ficha
 *   node scripts/vincular_cuenta_personal.js --todos --apply     # vincula las que tengan match único
 *   Opcionales: --valor=1234 (forzar ficha destino)  --empresa=1 (empresa para imPersonalEmpresas)
 */
require('dotenv').config();
const db = require('../src/models/db');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const TODOS = args.includes('--todos');
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const VALOR_FORZADO = arg('valor') ? Number(arg('valor')) : null;
const EMPRESA_ARG = arg('empresa') ? Number(arg('empresa')) : null;
const USUARIO = args.find((a) => !a.startsWith('--'));

const q = (sql, params = []) => db.executeQuery(sql, params.map((value) => ({ value })));
const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

async function resolverEmpresa() {
	if (EMPRESA_ARG) return EMPRESA_ARG;
	const emps = await q(`SELECT IDEMPRESA, DESCRIPCION FROM dbo.Empresas`);
	if (emps.length === 1) return Number(emps[0].IDEMPRESA);
	console.table(emps);
	throw new Error('Hay varias empresas: indicar --empresa=ID');
}

async function buscarFichas(cuenta) {
	if (VALOR_FORZADO) {
		return q(`SELECT Valor, ApellidoNombre, Numero, Matricula, Rol FROM imPersonal WHERE Valor = @p0`, [
			VALOR_FORZADO,
		]);
	}
	const dnis = [...new Set([soloDigitos(cuenta.NombreRed), soloDigitos(cuenta.NumeroDocumento)])].filter(
		(d) => d.length >= 6,
	);
	if (!dnis.length) return [];
	const rows = [];
	for (const dni of dnis) {
		const r = await q(
			`SELECT Valor, ApellidoNombre, Numero, Matricula, Rol
         FROM imPersonal
        WHERE REPLACE(REPLACE(LTRIM(RTRIM(CONVERT(VARCHAR(30), Numero))), '.', ''), '-', '') = @p0`,
			[dni],
		);
		for (const x of r) if (!rows.some((y) => y.Valor === x.Valor)) rows.push(x);
	}
	return rows;
}

async function procesar(cuenta, idEmpresa) {
	const user = String(cuenta.NombreRed).trim();
	const vpActual = cuenta.ValorPersonal;
	console.log(`\n--- ${user}  (ValorPersonal actual: ${vpActual ?? 'NULL'})`);

	if (Number(vpActual) > 0 && !VALOR_FORZADO) {
		const ficha = await q(`SELECT Valor, ApellidoNombre, Rol FROM imPersonal WHERE Valor = @p0`, [vpActual]);
		const emp = await q(`SELECT * FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0`, [vpActual]);
		console.log(`  ficha: ${ficha.length ? `${ficha[0].ApellidoNombre} (Rol ${ficha[0].Rol || 'SIN ROL'})` : 'NO EXISTE'}`);
		console.log(`  empresa: ${emp.length ? emp.map((e) => e.IdEmpresa).join(',') : 'SIN EMPRESA'}`);
		if (ficha.length && emp.length) return 'ok';
		if (ficha.length && !emp.length) {
			console.log(`  -> falta imPersonalEmpresas (${vpActual}, ${idEmpresa})`);
			if (APPLY) {
				await q(`INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (@p0, @p1)`, [vpActual, idEmpresa]);
				console.log('  ✓ empresa asignada');
			}
			return APPLY ? 'reparado' : 'pendiente';
		}
		console.log('  -> ValorPersonal apunta a una ficha inexistente: usar --valor=ID');
		return 'manual';
	}

	const fichas = await buscarFichas(cuenta);
	if (!fichas.length) {
		console.log('  ✗ No hay ficha en imPersonal con ese DNI. Crear la ficha del personal o usar --valor=ID.');
		return 'manual';
	}
	console.table(fichas);
	const candidatas = fichas;
	if (candidatas.length > 1) {
		console.log('  ✗ Varias fichas con ese DNI: elegir con --valor=ID.');
		return 'manual';
	}
	const destino = Number(candidatas[0].Valor);

	const ocupada = await q(
		`SELECT NombreRed FROM impassword WHERE ValorPersonal = @p0 AND UPPER(LTRIM(RTRIM(NombreRed))) <> UPPER(@p1)`,
		[destino, user],
	);
	if (ocupada.length) {
		console.log(`  ✗ La ficha ${destino} ya está vinculada al usuario "${ocupada[0].NombreRed}". Resolver a mano.`);
		return 'manual';
	}
	const yaEmpresa = await q(
		`SELECT 1 AS x FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1`,
		[destino, idEmpresa],
	);
	if (!candidatas[0].Rol || !String(candidatas[0].Rol).trim()) {
		console.log('  ⚠ La ficha no tiene Rol: va a entrar sólo a "Mi Perfil" hasta asignarle uno.');
	}

	console.log(`  PLAN: impassword.ValorPersonal ${vpActual ?? 'NULL'} -> ${destino}  (${candidatas[0].ApellidoNombre})`);
	if (!yaEmpresa.length) console.log(`        imPersonalEmpresas += (${destino}, ${idEmpresa})`);
	if (!APPLY) return 'pendiente';

	await q(`UPDATE impassword SET ValorPersonal = @p0 WHERE UPPER(LTRIM(RTRIM(NombreRed))) = UPPER(@p1)`, [destino, user]);
	if (!yaEmpresa.length) {
		await q(`INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (@p0, @p1)`, [destino, idEmpresa]);
	}
	console.log('  ✓ vinculado. El usuario debe cerrar sesión (o borrar datos del sitio) y volver a entrar.');
	return 'reparado';
}

(async () => {
	if (!USUARIO && !TODOS) {
		console.error('Uso: node scripts/vincular_cuenta_personal.js <DNI|usuario> [--apply]  |  --todos [--apply]');
		process.exit(1);
	}
	console.log(`BD: ${process.env.DB_SERVER}/${process.env.DB_NAME}   modo: ${APPLY ? 'APLICAR' : 'SOLO DIAGNÓSTICO'}`);
	const idEmpresa = await resolverEmpresa();

	const cuentas = TODOS
		? await q(
				`SELECT NombreRed, ValorPersonal, NumeroDocumento FROM impassword
          WHERE ValorPersonal IS NULL OR ValorPersonal <= 0 ORDER BY NombreRed`,
			)
		: await q(
				`SELECT NombreRed, ValorPersonal, NumeroDocumento FROM impassword
          WHERE UPPER(LTRIM(RTRIM(NombreRed))) = UPPER(LTRIM(RTRIM(@p0)))`,
				[USUARIO],
			);

	if (!cuentas.length) {
		console.log(TODOS ? 'No hay cuentas sin ficha.' : `"${USUARIO}" no existe en impassword.`);
		process.exit(0);
	}

	const resumen = {};
	for (const c of cuentas) {
		const r = await procesar(c, idEmpresa);
		(resumen[r] ||= []).push(String(c.NombreRed).trim());
	}

	const cero = await q(`SELECT COUNT(*) AS n FROM dbo.imPersonalEmpresas WHERE IdPersonal IS NULL OR IdPersonal <= 0`);
	if (Number(cero[0]?.n) > 0) {
		console.log(
			`\n⚠ imPersonalEmpresas tiene ${cero[0].n} fila(s) con IdPersonal 0/NULL: dejan loguear cuentas sin ficha.` +
				(APPLY && TODOS ? ' Se eliminan.' : ' Se eliminan con --todos --apply.'),
		);
		if (APPLY && TODOS) {
			await q(`DELETE FROM dbo.imPersonalEmpresas WHERE IdPersonal IS NULL OR IdPersonal <= 0`);
		}
	}

	console.log('\n=== RESUMEN ===');
	for (const [k, v] of Object.entries(resumen)) console.log(`  ${k}: ${v.join(', ')}`);
	if (!APPLY && resumen.pendiente) console.log('\nRepetir con --apply para aplicar.');
	process.exit(0);
})().catch((e) => {
	console.error('Error:', e.message);
	process.exit(1);
});
