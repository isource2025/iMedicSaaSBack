#!/usr/bin/env node
/**
 * Verifica que el código NUEVO resuelve los permisos exactamente igual que el
 * código ANTERIOR para todos los usuarios reales de la base central.
 *
 * SOLO LECTURA: la conexión rechaza cualquier sentencia que no sea SELECT/SHOW
 * y además fuerza la sesión a READ ONLY. No imprime nombres ni datos personales.
 *
 * Uso:
 *   1) Extraer la versión anterior:   git archive <commit> src | tar -x -C <carpeta>
 *   2) node scripts/verificar_equivalencia_permisos.js <carpeta>
 *
 * Diferencias permitidas (cambios intencionales): sólo permisos AGREGADOS
 *   - INTERNACION.MOVIMIENTOS.TRASLADAR
 *   - CONFIGURACION.ROLES.*
 * Cualquier permiso quitado o agregado fuera de esa lista es una VIOLACIÓN.
 * Sale con código 1 si hay violaciones.
 */
const path = require('path');
const fs = require('fs');

const dirNueva = path.join(__dirname, '..');
const dirBase = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!dirBase || !fs.existsSync(path.join(dirBase, 'src'))) {
	console.error('Uso: node scripts/verificar_equivalencia_permisos.js <carpeta con src/ de la versión anterior>');
	process.exit(2);
}

// Las dependencias (mysql2, dotenv...) se resuelven desde el proyecto actual.
process.env.NODE_PATH = path.join(dirNueva, 'node_modules');
require('module').Module._initPaths();
require('dotenv').config({ path: path.join(dirNueva, '.env') });
const mysql = require('mysql2/promise');

if (!process.env.MYSQL_PUBLIC_URL) {
	console.error('Falta MYSQL_PUBLIC_URL en el .env');
	process.exit(2);
}

const PERMITIDOS_AGREGADOS = (c) =>
	c === 'INTERNACION.MOVIMIENTOS.TRASLADAR' || c.startsWith('CONFIGURACION.ROLES.');

// ─── Conexión de solo lectura ────────────────────────────────────────────────
let bloqueados = 0;
let rellenosSimulados = 0;
const ddlOmitidos = new Map(); // tabla -> veces (CREATE TABLE IF NOT EXISTS sobre tabla ya existente)
const raw = mysql.createPool({ uri: process.env.MYSQL_PUBLIC_URL, connectionLimit: 8, connectTimeout: 20000 });
raw.pool.on('connection', (c) => c.query('SET SESSION TRANSACTION READ ONLY'));
const soloLectura = /^\s*(SELECT|SHOW)\b/i;
const crearSiNoExiste = /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?(\w+)`?/i;
const guardia = (metodo) => async (sql, params) => {
	const texto = String(sql);
	if (soloLectura.test(texto)) return raw[metodo](sql, params);

	// El sistema actual ejecuta "CREATE TABLE IF NOT EXISTS" al usar ciertas tablas.
	// Si la tabla YA existe es un no-op: se omite sin enviarla a la base.
	const m = crearSiNoExiste.exec(texto);
	if (m) {
		const [existe] = await raw.query(
			`SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
			[m[1]],
		);
		if (existe.length) {
			ddlOmitidos.set(m[1], (ddlOmitidos.get(m[1]) || 0) + 1);
			return [[], []];
		}
	}
	// Relleno automático que el sistema ya hace hoy (authCentral.service, sin cambios):
	// se simula sin escribir y se informa aparte.
	if (/^\s*INSERT\s+IGNORE\s+INTO\s+`?imPersonalRoles`?/i.test(texto)) {
		rellenosSimulados += 1;
		return [{ affectedRows: 0 }, []];
	}
	bloqueados += 1;
	throw new Error(`BLOQUEADO (solo lectura): ${texto.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
};
const poolGuardado = {
	query: guardia('query'),
	execute: guardia('execute'),
	getConnection: async () => {
		bloqueados += 1;
		throw new Error('BLOQUEADO (solo lectura): getConnection');
	},
};

function cargar(raiz) {
	const db = require(path.join(raiz, 'src/config/authCentralDb.js'));
	db.getAuthCentralPool = async () => poolGuardado;
	db.isAuthCentralEnabled = () => true;
	return {
		ctx: require(path.join(raiz, 'src/context/tenantContext.js')),
		permisos: require(path.join(raiz, 'src/services/permisos.service.js')),
		roles: require(path.join(raiz, 'src/services/roles.service.js')),
		authCentral: require(path.join(raiz, 'src/services/authCentral.service.js')),
		matriz: require(path.join(raiz, 'src/utils/permisos.js')),
	};
}

const enEmpresa = (t, idEmpresa, fn) => t.ctx.runWithTenant(idEmpresa, fn);
const firma = (o) => JSON.stringify(o);

async function enParalelo(items, n, fn) {
	let i = 0;
	await Promise.all(
		Array.from({ length: n }, async () => {
			while (i < items.length) {
				const k = i++;
				await fn(items[k], k);
			}
		}),
	);
}

(async () => {
	const viejo = cargar(dirBase);
	const nuevo = cargar(dirNueva);
	const fallos = [];
	const ok = (cond, msg) => {
		if (!cond) fallos.push(msg);
		return cond;
	};

	// 0) Estado del esquema nuevo (debe estar inactivo si la base no fue migrada)
	const schema = require(path.join(dirNueva, 'src/services/rolesCustomSchema.service.js'));
	const esquema = await schema.esquemaListo();
	console.log(`Esquema de roles personalizados instalado en la base: ${esquema ? 'SÍ' : 'NO (se usan las consultas de siempre)'}`);

	// 1) Plantillas de los roles estándar
	console.log('\n== Plantillas de roles estándar (código anterior vs nuevo) ==');
	const ESTANDAR = ['ADMIN', 'MEDICO', 'ENFERMERO', 'ADMINISTRATIVO', 'SUPER_ADMIN', 'CARGA_HC', 'PANEL_DATOS'];
	for (const r of ESTANDAR) {
		const a = new Set(viejo.matriz.permisosDeRol(r));
		const b = new Set(nuevo.matriz.permisosDeRol(r));
		const agregados = [...b].filter((c) => !a.has(c));
		const quitados = [...a].filter((c) => !b.has(c));
		const fuera = agregados.filter((c) => !PERMITIDOS_AGREGADOS(c));
		console.log(
			`  ${r.padEnd(15)} quitados: ${quitados.length}  agregados: ${agregados.length}` +
				(agregados.length ? `  (${agregados.join(', ')})` : ''),
		);
		ok(quitados.length === 0, `${r}: se QUITARON permisos: ${quitados.join(', ')}`);
		ok(fuera.length === 0, `${r}: permisos agregados no previstos: ${fuera.join(', ')}`);
	}
	// ADMIN debe poder otorgar cualquier rol estándar (control de subconjunto al asignar)
	const admin = new Set(nuevo.matriz.permisosDeRol('ADMIN'));
	for (const r of ESTANDAR.filter((x) => x !== 'SUPER_ADMIN' && x !== 'ADMIN')) {
		const falta = [...nuevo.matriz.permisosDeRol(r)].filter((c) => !admin.has(c));
		ok(falta.length === 0, `ADMIN no incluye todos los permisos de ${r}: ${falta.join(', ')}`);
	}

	// 2) Usuarios reales
	const [filas] = await poolGuardado.query(
		`SELECT IdEmpresa, Valor FROM imPersonal WHERE IdEmpresa IS NOT NULL
     UNION SELECT IdEmpresa, Valor FROM imPersonalRoles`,
	);
	let usuarios = filas.map((r) => ({ e: Number(r.IdEmpresa), v: Number(r.Valor) }));
	// SOLO="empresa:valor,empresa:valor" restringe la corrida (para investigar casos)
	if (process.env.SOLO) {
		const pedidos = new Set(process.env.SOLO.split(',').map((s) => s.trim()));
		usuarios = usuarios.filter((u) => pedidos.has(`${u.e}:${u.v}`));
	}
	const empresas = [...new Set(usuarios.map((u) => u.e))].sort((a, b) => a - b);
	console.log(`\n== Usuarios reales: ${usuarios.length} en ${empresas.length} empresa(s) ==`);

	let iguales = 0;
	let soloAgregados = 0;
	let sinRoles = 0;
	const violaciones = [];
	const porFirmaRoles = new Map();

	let reintentados = 0;
	const comparar = async (u) => {
		const a = await enEmpresa(viejo, u.e, () => viejo.permisos.permisosDeUsuario(u.v));
		const b = await enEmpresa(nuevo, u.e, () => nuevo.permisos.permisosDeUsuario(u.v));
		const pa = new Set(a.permisos || []);
		const pb = new Set(b.permisos || []);
		const quitados = [...pa].filter((c) => !pb.has(c));
		const agregados = [...pb].filter((c) => !pa.has(c));
		const fuera = agregados.filter((c) => !PERMITIDOS_AGREGADOS(c));
		const mismoRol = firma(a.rol) === firma(b.rol) && firma(a.roles) === firma(b.roles);
		return { a, b, pa, pb, quitados, agregados, fuera, mismoRol, limpio: !quitados.length && !fuera.length && mismoRol };
	};

	await enParalelo(usuarios, 8, async (u) => {
		let r;
		try {
			r = await comparar(u);
			// La red hacia la base puede fallar de forma transitoria (el sistema traga el error y
			// devuelve vacío): una discrepancia se reintenta (en serie) antes de darla por real.
			for (let i = 0; i < 3 && !r.limpio; i++) {
				reintentados += 1;
				await new Promise((res) => setTimeout(res, 500 * (i + 1)));
				r = await comparar(u);
			}
		} catch (e) {
			violaciones.push({ ...u, motivo: `error: ${e.message}` });
			return;
		}
		const { a, b, pa, pb, quitados, agregados, fuera, mismoRol } = r;
		if (!pa.size && !pb.size) sinRoles += 1;

		if (quitados.length || fuera.length || !mismoRol) {
			const nom = (x) => (x.roles || []).map((r) => `${r.nombre}${r.esPrincipal ? '*' : ''}`).join('+') || '(ninguno)';
			violaciones.push({
				...u,
				motivo:
					`quitados=${quitados.length} fueraDeLista=${fuera.length} mismoRol=${mismoRol}` +
					` | anterior: roles=${nom(a)} permisos=${pa.size} | nuevo: roles=${nom(b)} permisos=${pb.size}`,
			});
		} else if (agregados.length) {
			soloAgregados += 1;
			const k = (a.roles || []).map((r) => r.nombre).sort().join('+') || '(sin rol)';
			porFirmaRoles.set(k, (porFirmaRoles.get(k) || 0) + 1);
		} else {
			iguales += 1;
		}
	});

	console.log(`  Idénticos (mismos roles, mismos permisos): ${iguales}`);
	console.log(`  Sólo con permisos agregados previstos:      ${soloAgregados}`);
	console.log(`  Sin roles asignados (ambos vacíos):        ${sinRoles}`);
	console.log(`  Comparaciones reintentadas (fallo transitorio): ${reintentados}`);
	console.log(`  VIOLACIONES:                                ${violaciones.length}`);
	if (porFirmaRoles.size) {
		console.log('  Usuarios con permisos agregados, por combinación de roles:');
		for (const [k, n] of [...porFirmaRoles.entries()].sort((x, y) => y[1] - x[1])) console.log(`    ${k}: ${n}`);
	}
	for (const v of violaciones.slice(0, 20)) {
		console.log(`    empresa=${v.e} valor=${v.v} -> ${v.motivo}`);
	}
	ok(violaciones.length === 0, `${violaciones.length} usuario(s) con diferencias no previstas`);

	// 3) Catálogo de roles y lectura por id, por empresa
	console.log('\n== Catálogo de roles (por empresa) ==');
	let catIguales = 0;
	for (const e of empresas) {
		const a = await enEmpresa(viejo, e, () => viejo.roles.listarRoles());
		const b = await enEmpresa(nuevo, e, () => nuevo.roles.listarRoles());
		if (ok(firma(a) === firma(b), `listarRoles difiere en empresa ${e}`)) catIguales += 1;
		for (let id = 1; id <= 7; id++) {
			const ra = await enEmpresa(viejo, e, () => viejo.roles.obtenerRolPorId(id));
			const rb = await enEmpresa(nuevo, e, () => nuevo.roles.obtenerRolPorId(id));
			ok(firma(ra) === firma(rb), `obtenerRolPorId(${id}) difiere en empresa ${e}`);
		}
	}
	console.log(`  Empresas con catálogo idéntico: ${catIguales}/${empresas.length}`);

	// 4) Nada intentó escribir
	if (ddlOmitidos.size) {
		console.log(
			'\n== CREATE TABLE IF NOT EXISTS omitidos (tabla ya existente, sin efecto; comportamiento previo del sistema) ==',
		);
		for (const [t, n] of ddlOmitidos) console.log(`  ${t}: ${n}`);
	}
	if (rellenosSimulados) {
		console.log(
			`\n== Relleno automático de imPersonalRoles simulado (ya existía, sin cambios): ${rellenosSimulados} ==`,
		);
	}
	console.log(`\n== Otras escrituras bloqueadas: ${bloqueados} ==`);
	ok(bloqueados === 0, `el código intentó escribir en la base (${bloqueados} veces)`);

	await raw.end();

	console.log('\n' + '='.repeat(60));
	if (fallos.length) {
		console.log('RESULTADO: HAY DIFERENCIAS NO PREVISTAS');
		for (const f of fallos) console.log('  - ' + f);
		process.exit(1);
	}
	console.log('RESULTADO: EQUIVALENCIA COMPROBADA (sólo difieren los permisos agregados previstos)');
})().catch(async (e) => {
	console.error('ERROR:', e.message);
	try {
		await raw.end();
	} catch (_) {
		/* noop */
	}
	process.exit(2);
});
