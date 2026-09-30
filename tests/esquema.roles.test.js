/**
 * Instalacion explicita del esquema de roles + flags por empresa + compuertas de
 * habilitacion. Sin base real: un MySQL simulado que entiende information_schema y
 * el DDL exacto que genera el servicio.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

// ─── MySQL simulado ─────────────────────────────────────────────────────────
let db;
let habilitadoCentral = true;

function nuevaBase({ conImRoles = true } = {}) {
	return {
		tablas: new Set(conImRoles ? ['imRoles', 'imPersonalRoles'] : ['imPersonalRoles']),
		columnas: new Set(['imRoles.FechaCreacion']), // ya existe en produccion
		indices: new Map([['UQ_imRoles_Nombre', ['Nombre']]]),
		rolesPersonalizados: 0, // activos
		rolesBaja: 0, // bajas logicas
		asignacionesCustom: 0,
		permisosCustom: 0,
		dml: [],
		flags: new Map(), // "empresa:FLAG" -> activo
		ddl: [], // DDL ejecutado, en orden
		fallarSi: null, // (sql) => boolean : simula un corte
	};
}

const nombres = (sql) => [...sql.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

async function consultar(sql, params = []) {
	const s = sql.replace(/\s+/g, ' ').trim();

	if (/information_schema\.COLUMNS/.test(s)) return db.columnas.has(`${params[0]}.${params[1]}`) ? [{ ok: 1 }] : [];
	if (/information_schema\.TABLES/.test(s)) {
		const literal = s.match(/TABLE_NAME = '(\w+)'/);
		return db.tablas.has(literal ? literal[1] : params[0]) ? [{ ok: 1 }] : [];
	}
	if (/information_schema\.STATISTICS/.test(s) && /GROUP BY INDEX_NAME/.test(s)) {
		return [...db.indices].map(([nombre, cols]) => ({
			nombre,
			columnas: cols.length,
			conNombre: cols.includes('Nombre') ? 1 : 0,
		}));
	}
	if (/information_schema\.STATISTICS/.test(s)) return db.indices.has(params[1]) ? [{ ok: 1 }] : [];

	if (/^SELECT COUNT\(\*\) AS n FROM imRoles WHERE IdEmpresa <> 0 AND Activo = 1/.test(s)) return [{ n: db.rolesPersonalizados }];
	if (/^SELECT COUNT\(\*\) AS n FROM imRoles WHERE IdEmpresa <> 0 AND Activo = 0/.test(s)) return [{ n: db.rolesBaja }];
	if (/^SELECT COUNT\(\*\) AS n FROM imPersonalRoles pr INNER JOIN imRoles/.test(s)) return [{ n: db.asignacionesCustom }];
	if (/^DELETE FROM `imRolPermisosCustom`/.test(s)) {
		db.dml.push(s);
		db.permisosCustom = 0;
		return { affectedRows: 1 };
	}
	if (/^DELETE FROM `imRoles` WHERE `IdEmpresa` <> 0 AND `Activo` = 0/.test(s)) {
		db.dml.push(s);
		db.rolesBaja = 0;
		return { affectedRows: 1 };
	}
	if (/^SELECT COUNT\(\*\) AS n FROM imRolPermisosCustom/.test(s)) return [{ n: db.permisosCustom }];
	if (/^SELECT COUNT\(\*\) AS n FROM imRoles/.test(s)) return [{ n: 7 + db.rolesPersonalizados }];

	if (/^SELECT Activo FROM imFeatureFlags/.test(s)) {
		if (!db.tablas.has('imFeatureFlags')) throw new Error("Table 'imFeatureFlags' doesn't exist");
		const k = `${params[0]}:${params[1]}`;
		return db.flags.has(k) ? [{ Activo: db.flags.get(k) }] : [];
	}
	if (/^INSERT INTO imFeatureFlags/.test(s)) {
		if (!db.tablas.has('imFeatureFlags')) throw new Error("Table 'imFeatureFlags' doesn't exist");
		db.flags.set(`${params[0]}:${params[1]}`, params[2]);
		return { affectedRows: 1 };
	}
	if (/^SELECT IdEmpresa FROM imFeatureFlags/.test(s)) {
		return [...db.flags]
			.filter(([k, v]) => v === 1 && k.endsWith(`:${params[0]}`))
			.map(([k]) => ({ IdEmpresa: Number(k.split(':')[0]) }));
	}

	// DDL
	if (/^(ALTER|CREATE|DROP)\b/.test(s)) {
		if (db.fallarSi && db.fallarSi(s)) throw new Error('corte simulado');
		db.ddl.push(s);
		const n = nombres(s);
		if (/ADD COLUMN/.test(s)) db.columnas.add(`${n[0]}.${n[1]}`);
		else if (/DROP COLUMN/.test(s)) db.columnas.delete(`${n[0]}.${n[1]}`);
		else if (/ADD UNIQUE INDEX/.test(s)) db.indices.set(n[1], n.slice(2));
		else if (/DROP INDEX/.test(s)) db.indices.delete(n[1]);
		else if (/^CREATE TABLE/.test(s)) db.tablas.add(n[0]);
		else if (/^DROP TABLE/.test(s)) db.tablas.delete(n[0]);
		else throw new Error('DDL no soportado por el simulador: ' + s);
		return { affectedRows: 0 };
	}
	throw new Error('Consulta no prevista: ' + s.slice(0, 80));
}

const dbPath = require.resolve(src('config/authCentralDb.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		isAuthCentralEnabled: () => habilitadoCentral,
		getAuthCentralPool: async () => ({ query: async (sql, params) => [await consultar(sql, params)] }),
	},
};

const schema = require(src('services/rolesCustomSchema.service.js'));
const flags = require(src('services/featureFlags.service.js'));
const auditoria = require(src('services/auditoria.service.js'));
const rolesCustom = require(src('services/rolesCustom.service.js'));

function reiniciar(opciones) {
	db = nuevaBase(opciones);
	habilitadoCentral = true;
	delete process.env.ROLES_PERSONALIZADOS_ENABLED;
	schema._reiniciarCache();
	flags._reiniciarCache();
	auditoria._reiniciarCache();
}

const ddlDe = (patron) => db.ddl.findIndex((s) => patron.test(s));

// ─── Plan e instalacion ─────────────────────────────────────────────────────

test('planificar solo lee: no ejecuta DDL y reconoce lo que ya existe', async () => {
	reiniciar();
	const pasos = await schema.planificar(consultar);
	assert.equal(db.ddl.length, 0);
	assert.equal(pasos.filter((p) => p.aplicado).length, 1); // FechaCreacion
	assert.equal(pasos.find((p) => p.id === 'columna:FechaCreacion').aplicado, true);
	assert.ok(pasos.some((p) => p.id === 'quitar-indice:UQ_imRoles_Nombre'));
});

test('aplicar instala todo, crea el indice nuevo ANTES de quitar el viejo y no toca FechaCreacion', async () => {
	reiniciar();
	const r = await schema.aplicar(consultar);
	assert.equal(r.simulado, false);

	const iNuevo = ddlDe(/ADD UNIQUE INDEX `UQ_imRoles_Empresa_Nombre`/);
	const iViejo = ddlDe(/DROP INDEX `UQ_imRoles_Nombre`/);
	assert.ok(iNuevo >= 0 && iViejo >= 0 && iNuevo < iViejo);
	assert.equal(ddlDe(/COLUMN `FechaCreacion`/), -1);

	assert.equal(db.indices.has('UQ_imRoles_Nombre'), false);
	assert.deepEqual(db.indices.get('UQ_imRoles_Empresa_Nombre'), ['IdEmpresa', 'Nombre']);
	for (const t of ['imRolPermisosCustom', 'imAuditoria', 'imFeatureFlags']) assert.ok(db.tablas.has(t), t);
	assert.equal((await schema.diagnosticar(consultar)).instalado, true);
	assert.equal(await schema.esquemaListo(), true);
});

test('aplicar es idempotente: la segunda corrida no ejecuta nada', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	const antes = db.ddl.length;
	const r = await schema.aplicar(consultar);
	assert.deepEqual(r.ejecutados, []);
	assert.equal(db.ddl.length, antes);
});

test('simular no ejecuta nada pero informa el plan', async () => {
	reiniciar();
	const r = await schema.aplicar(consultar, { simular: true });
	assert.equal(r.simulado, true);
	assert.ok(r.ejecutados.length >= 9);
	assert.equal(db.ddl.length, 0);
	assert.equal(await schema.esquemaListo(), false);
});

test('si se corta al crear el indice nuevo, el viejo NO se quita; al reintentar continua', async () => {
	reiniciar();
	db.fallarSi = (sql) => /ADD UNIQUE INDEX `UQ_imRoles_Empresa_Nombre`/.test(sql);
	await assert.rejects(() => schema.aplicar(consultar), /corte simulado/);
	assert.equal(db.indices.has('UQ_imRoles_Nombre'), true);
	assert.equal(ddlDe(/DROP INDEX/), -1);

	db.fallarSi = null;
	await schema.aplicar(consultar);
	assert.equal((await schema.diagnosticar(consultar)).instalado, true);
	assert.equal(db.indices.has('UQ_imRoles_Nombre'), false);
});

test('sin imRoles no se toca nada (precondicion)', async () => {
	reiniciar({ conImRoles: false });
	await assert.rejects(() => schema.aplicar(consultar), (e) => e.statusCode === 409 && /imRoles/.test(e.message));
	assert.equal(db.ddl.length, 0);
});

test('nunca se emite DELETE, UPDATE ni TRUNCATE sobre los datos existentes', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	const pasos = await schema.planificar(consultar);
	for (const s of [...db.ddl, ...pasos.map((p) => p.sql)]) assert.doesNotMatch(s, /^\s*(DELETE|UPDATE|TRUNCATE|INSERT)\b/i);
});

// ─── Reversa ────────────────────────────────────────────────────────────────

test('revertir se niega si hay roles personalizados o permisos guardados', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	const n = db.ddl.length;

	db.rolesPersonalizados = 2;
	await assert.rejects(() => schema.revertir(consultar), (e) => e.statusCode === 409 && /rol\(es\)/.test(e.message));
	db.rolesPersonalizados = 0;
	db.permisosCustom = 4;
	await assert.rejects(() => schema.revertir(consultar), (e) => e.statusCode === 409);
	assert.equal(db.ddl.length, n);
});

test('revertir vuelve al estado original (restaura unicidad primero, conserva FechaCreacion y tablas generales)', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	db.ddl.length = 0;
	await schema.revertir(consultar);

	const iRestaura = ddlDe(/ADD UNIQUE INDEX `UQ_imRoles_Nombre`/);
	const iQuita = ddlDe(/DROP INDEX `UQ_imRoles_Empresa_Nombre`/);
	assert.ok(iRestaura >= 0 && iQuita >= 0 && iRestaura < iQuita);

	assert.deepEqual([...db.indices.keys()], ['UQ_imRoles_Nombre']);
	assert.deepEqual([...db.columnas], ['imRoles.FechaCreacion']);
	assert.equal(db.tablas.has('imRolPermisosCustom'), false);
	assert.equal(db.tablas.has('imAuditoria'), true);
	assert.equal(db.tablas.has('imFeatureFlags'), true);
});

test('revertir: roles dados de baja se conservan salvo --purgar-bajas; nunca se borran roles activos', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	db.rolesBaja = 3;
	db.permisosCustom = 9;
	const n = db.ddl.length;
	await assert.rejects(() => schema.revertir(consultar), (e) => e.statusCode === 409 && /baja/.test(e.message) && /purgar-bajas/.test(e.message));
	assert.equal(db.ddl.length, n);
	assert.equal(db.dml.length, 0);

	// con roles activos, ni siquiera la purga alcanza
	db.rolesPersonalizados = 1;
	await assert.rejects(() => schema.revertir(consultar, { purgarBajas: true }), (e) => e.statusCode === 409 && /activo/.test(e.message));
	assert.equal(db.dml.length, 0);

	db.rolesPersonalizados = 0;
	await schema.revertir(consultar, { purgarBajas: true });
	assert.equal(db.dml.length, 2);
	assert.match(db.dml[1], /Activo.{1,2} = 0$/); // el DELETE de roles solo alcanza las bajas
	assert.deepEqual([...db.indices.keys()], ['UQ_imRoles_Nombre']);
});

test('revertir: asignaciones de usuarios a roles personalizados bloquean la reversa', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	db.asignacionesCustom = 2;
	await assert.rejects(() => schema.revertir(consultar, { purgarBajas: true }), (e) => e.statusCode === 409 && /asignaci/.test(e.message));
});
// ─── Flags por empresa ──────────────────────────────────────────────────────

test('flag: falla cerrado sin tabla, sin auth central o con empresa invalida', async () => {
	reiniciar();
	assert.equal(await flags.habilitada(102, flags.FLAG_ROLES_PERSONALIZADOS), false); // sin tabla
	assert.equal(await flags.habilitada(0, flags.FLAG_ROLES_PERSONALIZADOS), false);
	assert.equal(await flags.habilitada('x', flags.FLAG_ROLES_PERSONALIZADOS), false);
	habilitadoCentral = false;
	assert.equal(await flags.habilitada(102, flags.FLAG_ROLES_PERSONALIZADOS), false);
});

test('flag: se activa por empresa, sin afectar a las demas, y respeta el cache al apagar', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	const F = flags.FLAG_ROLES_PERSONALIZADOS;

	await flags.establecer(102, F, true, { consultar });
	assert.equal(await flags.habilitada(102, F), true);
	assert.equal(await flags.habilitada(100, F), false);
	assert.deepEqual(await flags.empresasHabilitadas(F, { consultar }), [102]);

	await flags.establecer(102, F, false); // invalida el cache local
	assert.equal(await flags.habilitada(102, F), false);
});

test('flag: valida empresa y nombre', async () => {
	reiniciar();
	await assert.rejects(() => flags.establecer(0, 'X_Y_Z', true, { consultar }), /Empresa/);
	await assert.rejects(() => flags.establecer(1, 'con espacio', true, { consultar }), /flag/);
});

// ─── Compuertas de la gestion de roles ──────────────────────────────────────

const actor = { valorPersonal: 1, permisos: [] };
const alta = (extra = {}) => rolesCustom.crearRol({ idEmpresa: 102, actor, nombre: 'Rol de prueba', ...extra });

test('crearRol: empresa invalida es 400 antes que cualquier otra compuerta', async () => {
	reiniciar();
	await assert.rejects(() => alta({ idEmpresa: 0 }), (e) => e.statusCode === 400);
});

test('crearRol: sin auth central 409; con interruptor de emergencia 503', async () => {
	reiniciar();
	habilitadoCentral = false;
	await assert.rejects(() => alta(), (e) => e.statusCode === 409);

	reiniciar();
	process.env.ROLES_PERSONALIZADOS_ENABLED = 'false';
	await assert.rejects(() => alta(), (e) => e.statusCode === 503);
});

test('crearRol: esquema NO instalado responde 409 y no ejecuta DDL', async () => {
	reiniciar();
	await assert.rejects(() => alta(), (e) => e.statusCode === 409 && /no est/.test(e.message));
	assert.equal(db.ddl.length, 0);
});

test('crearRol: esquema instalado pero empresa sin habilitar responde 403', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	await assert.rejects(() => alta(), (e) => e.statusCode === 403 && /no est/.test(e.message));
	assert.equal(await flags.habilitada(101, flags.FLAG_ROLES_PERSONALIZADOS), false);
});

test('crearRol: con esquema y empresa habilitada pasa las compuertas (falla luego por validacion)', async () => {
	reiniciar();
	await schema.aplicar(consultar);
	await flags.establecer(102, flags.FLAG_ROLES_PERSONALIZADOS, true, { consultar });
	await assert.rejects(() => alta({ nombre: '' }), (e) => e.statusCode === 400);
	// otra empresa sigue bloqueada
	await assert.rejects(() => alta({ idEmpresa: 100 }), (e) => e.statusCode === 403);
});