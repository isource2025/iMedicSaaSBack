/**
 * Normaliza cuentas de login (impassword, Clarion) contra las fichas del sistema web (imPersonal)
 * en instalaciones on-premise. NO borra filas de impassword: las vincula, para no romper Clarion.
 *
 * Correr en el servidor del backend (BD del .env: DB_SERVER/DB_NAME):
 *   node scripts/normalizar_cuentas_clarion.js                      # plan, no escribe
 *   node scripts/normalizar_cuentas_clarion.js --apply              # aplica (con backup completo antes)
 *   node scripts/normalizar_cuentas_clarion.js --apply --renombrar=999010:CARMENL --renombrar=5527:VICTORA
 *   Opcional: --empresa=1
 *
 * Reglas:
 *  A. Cuenta sin ficha (ValorPersonal 0/NULL):
 *     1. si el mismo usuario tiene otra fila vinculada a UNA sola persona -> se vincula a esa persona;
 *     2. si no, ficha única con su DNI (NombreRed numérico o NumeroDocumento) -> se vincula;
 *     3. si no, ficha única con el mismo apellido y nombre -> se vincula (marcado "revisar");
 *     4. si no, queda para resolver a mano (crear la ficha y volver a correr).
 *  B. Mismo usuario para personas distintas -> hay que renombrar una (--renombrar=VP:NUEVO).
 *  C. Persona vinculada sin empresa en imPersonalEmpresas -> se agrega.
 *  D. Filas de imPersonalEmpresas con IdPersonal 0/NULL -> se borran (habilitaban logins sin ficha).
 */
require('dotenv').config();
const db = require('../src/models/db');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EMPRESA_ARG = args.find((a) => a.startsWith('--empresa='))?.split('=')[1];
const RENOMBRES = new Map(
	args
		.filter((a) => a.startsWith('--renombrar='))
		.map((a) => a.split('=')[1].split(':'))
		.map(([vp, nombre]) => [Number(vp), String(nombre || '').trim()]),
);

const q = (sql, params = []) => db.executeQuery(sql, params.map((value) => ({ value })));
const normUser = (s) => String(s ?? '').trim().toUpperCase();
const digitos = (s) => String(s ?? '').replace(/\D/g, '');
const normNombre = (s) =>
	String(s ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
const vpValido = (v) => Number(v) > 0;

async function resolverEmpresa() {
	if (EMPRESA_ARG) return Number(EMPRESA_ARG);
	const emps = await q(`SELECT IDEMPRESA, DESCRIPCION FROM dbo.Empresas`);
	if (emps.length === 1) return Number(emps[0].IDEMPRESA);
	console.table(emps);
	throw new Error('Hay varias empresas: indicar --empresa=ID');
}

(async () => {
	console.log(`BD: ${process.env.DB_SERVER}/${process.env.DB_NAME}   modo: ${APPLY ? 'APLICAR' : 'PLAN (no escribe)'}`);
	const idEmpresa = await resolverEmpresa();

	const cuentas = await q(`
    SELECT LTRIM(RTRIM(pw.NombreRed)) AS NombreRed, pw.ValorPersonal, pw.NumeroDocumento,
           pw.Apellido, pw.Nombres,
           p.Valor AS FichaValor, p.ApellidoNombre
      FROM impassword pw
      LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
     WHERE LTRIM(RTRIM(ISNULL(pw.NombreRed, ''))) <> ''`);
	const fichas = await q(`SELECT Valor, ApellidoNombre, Numero FROM imPersonal`);
	const empresasPorVp = new Set(
		(await q(`SELECT IdPersonal FROM dbo.imPersonalEmpresas WHERE IdEmpresa = @p0`, [idEmpresa])).map((r) =>
			Number(r.IdPersonal),
		),
	);
	const fichaPorValor = new Map(fichas.map((f) => [Number(f.Valor), f]));
	const fichasPorDni = new Map();
	const fichasPorNombre = new Map();
	for (const f of fichas) {
		const d = digitos(f.Numero);
		if (d.length >= 6) (fichasPorDni.get(d) || fichasPorDni.set(d, []).get(d)).push(f);
		const n = normNombre(f.ApellidoNombre);
		if (n) (fichasPorNombre.get(n) || fichasPorNombre.set(n, []).get(n)).push(f);
	}
	const usuariosExistentes = new Set(cuentas.map((c) => normUser(c.NombreRed)));

	const grupos = new Map();
	for (const c of cuentas) {
		const k = normUser(c.NombreRed);
		(grupos.get(k) || grupos.set(k, []).get(k)).push(c);
	}

	const plan = [];
	const manual = [];
	const vinculos = [];
	const renombres = [];
	const vpFinales = new Set();

	for (const [usuario, filas] of grupos) {
		const vinculadas = filas.filter((f) => vpValido(f.ValorPersonal) && f.FichaValor != null);
		const personas = [...new Set(vinculadas.map((f) => Number(f.ValorPersonal)))];
		vinculadas.forEach((f) => vpFinales.add(Number(f.ValorPersonal)));

		for (const f of filas.filter((x) => vpValido(x.ValorPersonal) && x.FichaValor == null)) {
			manual.push({ usuario: f.NombreRed, vp: f.ValorPersonal, motivo: 'ValorPersonal apunta a una ficha que no existe en imPersonal' });
		}

		// B. mismo usuario, personas distintas
		if (personas.length > 1) {
			for (const vp of personas.slice(1)) {
				const ficha = fichaPorValor.get(vp);
				const nuevo = RENOMBRES.get(vp);
				if (nuevo) {
					if (usuariosExistentes.has(normUser(nuevo))) {
						manual.push({ usuario, vp, motivo: `--renombrar: "${nuevo}" ya existe` });
						continue;
					}
					usuariosExistentes.add(normUser(nuevo));
					renombres.push({ usuario, vp, nuevo });
					plan.push({ usuario, vp, accion: 'RENOMBRAR', destino: nuevo, persona: ficha?.ApellidoNombre, motivo: 'mismo usuario que otra persona' });
				} else {
					const iniciales = normNombre(ficha?.ApellidoNombre).split(' ');
					let sugerido = `${usuario}${(iniciales[0] || 'X')[0]}`;
					for (let i = 1; usuariosExistentes.has(sugerido) && i < (iniciales[0] || '').length; i++) {
						sugerido = `${usuario}${iniciales[0].slice(0, i + 1)}`;
					}
					manual.push({
						usuario,
						vp,
						motivo: `Usuario compartido con ${personas.filter((p) => p !== vp).map((p) => fichaPorValor.get(p)?.ApellidoNombre).join(', ')}. Renombrar: --renombrar=${vp}:${sugerido}  (${ficha?.ApellidoNombre})`,
					});
				}
			}
		}

		// A. cuentas sin ficha
		for (const f of filas.filter((x) => !vpValido(x.ValorPersonal))) {
			let destino = null;
			let regla = '';
			if (personas.length === 1) {
				destino = personas[0];
				regla = 'misma cuenta ya vinculada en el sistema web';
			} else if (personas.length > 1) {
				manual.push({ usuario, vp: f.ValorPersonal, motivo: 'sin ficha y el usuario ya es de varias personas: renombrar primero' });
				continue;
			} else {
				const dnis = [...new Set([digitos(f.NombreRed), digitos(f.NumeroDocumento)])].filter((d) => d.length >= 6);
				const porDni = [...new Map(dnis.flatMap((d) => fichasPorDni.get(d) || []).map((x) => [x.Valor, x])).values()];
				if (porDni.length === 1) {
					destino = Number(porDni[0].Valor);
					regla = 'ficha con el mismo DNI';
				} else if (porDni.length > 1) {
					manual.push({ usuario, vp: f.ValorPersonal, motivo: `varias fichas con su DNI: ${porDni.map((x) => x.Valor).join(', ')}` });
					continue;
				} else {
					const ap = normNombre(f.Apellido);
					const no = normNombre(f.Nombres);
					const candidatos = ap && no ? [`${ap} ${no}`, `${no} ${ap}`] : [];
					const porNombre = [...new Map(candidatos.flatMap((n) => fichasPorNombre.get(n) || []).map((x) => [x.Valor, x])).values()];
					if (porNombre.length === 1) {
						destino = Number(porNombre[0].Valor);
						regla = 'REVISAR: coincide sólo por apellido y nombre';
					} else {
						manual.push({
							usuario,
							vp: f.ValorPersonal,
							motivo: `sin ficha en el sistema web (${[f.Apellido, f.Nombres].filter(Boolean).join(' ') || 'sin nombre'}). Dar de alta el personal y volver a correr`,
						});
						continue;
					}
				}
			}
			vinculos.push({ usuario, destino });
			vpFinales.add(destino);
			plan.push({ usuario, vp: f.ValorPersonal ?? 'NULL', accion: 'VINCULAR', destino, persona: fichaPorValor.get(destino)?.ApellidoNombre, motivo: regla });
		}
	}

	// C. empresa faltante
	const faltaEmpresa = [...vpFinales].filter((vp) => !empresasPorVp.has(vp));
	for (const vp of faltaEmpresa) {
		plan.push({ usuario: '', vp, accion: 'ASIGNAR EMPRESA', destino: idEmpresa, persona: fichaPorValor.get(vp)?.ApellidoNombre, motivo: 'sin imPersonalEmpresas' });
	}

	// D. vínculos de empresa con IdPersonal 0/NULL
	const ceros = await q(`SELECT COUNT(*) AS n FROM dbo.imPersonalEmpresas WHERE IdPersonal IS NULL OR IdPersonal <= 0`);
	if (Number(ceros[0].n) > 0) {
		plan.push({ usuario: '', vp: '0/NULL', accion: 'BORRAR imPersonalEmpresas', destino: '', persona: '', motivo: `${ceros[0].n} fila(s)` });
	}

	// Informativo: fichas en rango reservado (no aparecen en Personal)
	const reservadas = cuentas.filter((c) => Number(c.ValorPersonal) >= 900000 && c.FichaValor != null);

	console.log('\n=== PLAN ===');
	if (plan.length) console.table(plan);
	else console.log('  Nada para cambiar.');

	if (manual.length) {
		console.log('\n=== A RESOLVER A MANO ===');
		console.table(manual);
	}
	if (reservadas.length) {
		console.log('\n=== Fichas en rango reservado (>= 900000): no aparecen en Configuración > Personal ===');
		console.table(reservadas.map((c) => ({ usuario: c.NombreRed, vp: c.ValorPersonal, persona: c.ApellidoNombre })));
	}

	if (!APPLY) {
		console.log('\nRepetir con --apply para aplicar. Después: node scripts/test_login_cuentas.js');
		process.exit(0);
	}
	if (!plan.length) process.exit(0);

	const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
	await q(`SELECT * INTO dbo.impassword_bak_${ts} FROM impassword`);
	await q(`SELECT * INTO dbo.imPersonalEmpresas_bak_${ts} FROM dbo.imPersonalEmpresas`);
	console.log(`\nBackup: dbo.impassword_bak_${ts}, dbo.imPersonalEmpresas_bak_${ts}`);

	for (const r of renombres) {
		await q(
			`UPDATE impassword SET NombreRed = @p0 WHERE UPPER(LTRIM(RTRIM(NombreRed))) = @p1 AND ValorPersonal = @p2`,
			[r.nuevo, r.usuario, r.vp],
		);
		console.log(`  ✓ ${r.usuario} (${r.vp}) -> ${r.nuevo}`);
	}
	for (const v of vinculos) {
		await q(
			`UPDATE impassword SET ValorPersonal = @p0 WHERE UPPER(LTRIM(RTRIM(NombreRed))) = @p1 AND ISNULL(ValorPersonal, 0) <= 0`,
			[v.destino, v.usuario],
		);
		console.log(`  ✓ ${v.usuario} vinculado a ${v.destino}`);
	}
	for (const vp of faltaEmpresa) {
		await q(
			`IF NOT EXISTS (SELECT 1 FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1)
         INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (@p0, @p1)`,
			[vp, idEmpresa],
		);
		console.log(`  ✓ empresa ${idEmpresa} asignada a ${vp}`);
	}
	if (Number(ceros[0].n) > 0) {
		await q(`DELETE FROM dbo.imPersonalEmpresas WHERE IdPersonal IS NULL OR IdPersonal <= 0`);
		console.log(`  ✓ borradas ${ceros[0].n} fila(s) de imPersonalEmpresas con IdPersonal 0/NULL`);
	}
	console.log('\nListo. Ahora: node scripts/test_login_cuentas.js');
	process.exit(0);
})().catch((e) => {
	console.error('Error:', e.message);
	process.exit(1);
});
