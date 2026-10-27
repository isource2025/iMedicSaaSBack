/**
 * Overrides por persona: diff/aplicar/validación + fail-safe sin tabla.
 * Sin BD real: MySQL simulado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

let db;
let habilitadoCentral = true;

function nuevaBase({ conTabla = true } = {}) {
	return {
		tablas: new Set(conTabla ? ['imPersonalPermisosOverride'] : []),
		filas: new Map(), // "emp|vp|codigo" -> efecto
		ddl: [],
	};
}

async function consultar(sql, params = []) {
	const s = sql.replace(/\s+/g, ' ').trim();

	if (/^CREATE TABLE IF NOT EXISTS/.test(s)) {
		db.ddl.push(s);
		db.tablas.add('imPersonalPermisosOverride');
		return { affectedRows: 0 };
	}
	if (/FROM imPersonalPermisosOverride/.test(s) && /SELECT Codigo/.test(s)) {
		if (!db.tablas.has('imPersonalPermisosOverride')) {
			throw Object.assign(new Error("Table doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
		}
		const emp = Number(params[0]);
		const vp = Number(params[1]);
		const out = [];
		for (const [k, efecto] of db.filas) {
			const [e, v, codigo] = k.split('|');
			if (Number(e) === emp && Number(v) === vp) out.push({ codigo, efecto });
		}
		return out;
	}
	if (/^DELETE FROM imPersonalPermisosOverride/.test(s)) {
		const emp = Number(params[0]);
		const vp = Number(params[1]);
		for (const k of [...db.filas.keys()]) {
			const [e, v] = k.split('|');
			if (Number(e) === emp && Number(v) === vp) db.filas.delete(k);
		}
		return { affectedRows: 1 };
	}
	if (/^INSERT INTO imPersonalPermisosOverride/.test(s)) {
		const valores = params[0]; // array de filas
		for (const f of valores) {
			const [emp, vp, codigo, efecto] = f;
			db.filas.set(`${emp}|${vp}|${codigo}`, efecto);
		}
		return { affectedRows: valores.length };
	}
	throw new Error('SQL no previsto: ' + s.slice(0, 100));
}

const dbPath = require.resolve(src('config/authCentralDb.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		isAuthCentralEnabled: () => habilitadoCentral,
		getAuthCentralPool: async () => ({
			query: async (sql, params) => [await consultar(sql, params)],
			getConnection: async () => ({
				query: async (sql, params) => [await consultar(sql, params)],
				beginTransaction: async () => {},
				commit: async () => {},
				rollback: async () => {},
				release: () => {},
			}),
		}),
	},
};

const svc = require(src('services/personalPermisos.service.js'));
const matriz = require(src('utils/permisos.js'));

function reiniciar(opts) {
	db = nuevaBase(opts);
	habilitadoCentral = true;
	svc._reiniciar();
}

// ─── Puros ──────────────────────────────────────────────────────────────────

test('aplicar: grants suman y denies restan', () => {
	const base = ['A', 'B', 'C'];
	assert.deepEqual(svc.aplicar(base, ['D'], ['B']).sort(), ['A', 'C', 'D']);
	assert.deepEqual(svc.aplicar(base, [], []).sort(), ['A', 'B', 'C']);
	assert.deepEqual(svc.aplicar([], ['X'], ['Y']), ['X']);
});

test('diff: extras => GRANT, quitados de la base => DENY; ignora restringidos', () => {
	const base = ['TURNOS.AGENDA.VER', 'TURNOS.AGENDA.CREAR', 'PLATAFORMA.EMPRESAS.VER'];
	const efectivos = ['TURNOS.AGENDA.VER', 'INTERNACION.CAMAS.VER'];
	const { grants, denies } = svc.diff(base, efectivos);
	assert.ok(grants.includes('INTERNACION.CAMAS.VER'));
	assert.ok(denies.includes('TURNOS.AGENDA.CREAR'));
	assert.ok(!grants.includes('PLATAFORMA.EMPRESAS.VER'));
	assert.ok(!denies.includes('PLATAFORMA.EMPRESAS.VER')); // restringido fuera del diff
});

test('diff + aplicar es idempotente sobre la base', () => {
	const base = matriz.permisosDeRol('MEDICO').slice(0, 20);
	const efectivos = new Set(base);
	efectivos.delete(base[0]);
	efectivos.add('CONFIGURACION.PERSONAL.VER');
	const { grants, denies } = svc.diff(base, [...efectivos]);
	const otraVez = svc.aplicar(base, grants, denies);
	assert.deepEqual([...otraVez].sort(), [...efectivos].filter((c) => !c.startsWith('PLATAFORMA.')).sort());
});

test('validarEscritura: no otorga ni quita lo que el actor no tiene', () => {
	const base = ['TURNOS.AGENDA.VER', 'TURNOS.AGENDA.CREAR'];
	const mal = svc.validarEscritura({
		grants: ['INTERNACION.CAMAS.VER'],
		denies: ['TURNOS.AGENDA.CREAR'],
		permisosActor: ['TURNOS.AGENDA.VER'],
		base,
	});
	assert.equal(mal.ok, false);
	assert.ok(mal.errores.some((e) => /INTERNACION/.test(e)));
	assert.ok(mal.errores.some((e) => /quitar.*TURNOS\.AGENDA\.CREAR/.test(e)));

	const bien = svc.validarEscritura({
		grants: ['TURNOS.AGENDA.EDITAR'],
		denies: ['TURNOS.AGENDA.CREAR'],
		permisosActor: ['TURNOS.AGENDA.VER', 'TURNOS.AGENDA.CREAR', 'TURNOS.AGENDA.EDITAR'],
		base,
	});
	assert.equal(bien.ok, true);
});

// ─── Persistencia simulada ──────────────────────────────────────────────────

test('sin auth central: listar vacío y guardar 409', async () => {
	reiniciar();
	habilitadoCentral = false;
	assert.deepEqual(await svc.listarOverrides(103, 1), { grants: [], denies: [] });
	await assert.rejects(
		() =>
			svc.guardarDesdeEfectivos({
				idEmpresa: 103,
				valorPersonal: 1,
				base: ['TURNOS.AGENDA.VER'],
				efectivos: [],
				actor: { permisos: ['TURNOS.AGENDA.VER'] },
			}),
		(e) => e.statusCode === 409,
	);
});

test('sin tabla: listar vacío (fail-safe); asegurarTabla la crea', async () => {
	reiniciar({ conTabla: false });
	assert.deepEqual(await svc.listarOverrides(103, 55), { grants: [], denies: [] });
	assert.equal(await svc.asegurarTabla(), true);
	assert.ok(db.tablas.has('imPersonalPermisosOverride'));
});

test('guardarDesdeEfectivos persiste GRANT y DENY y listar los devuelve', async () => {
	reiniciar();
	const base = ['TURNOS.AGENDA.VER', 'TURNOS.AGENDA.CREAR', 'TURNOS.AGENDA.EDITAR'];
	const efectivos = ['TURNOS.AGENDA.VER', 'INTERNACION.CAMAS.VER'];
	const actor = {
		valorPersonal: 9,
		permisos: [...base, 'INTERNACION.CAMAS.VER'],
	};
	const r = await svc.guardarDesdeEfectivos({
		idEmpresa: 103,
		valorPersonal: 55,
		base,
		efectivos,
		actor,
	});
	assert.ok(r.grants.includes('INTERNACION.CAMAS.VER'));
	assert.ok(r.denies.includes('TURNOS.AGENDA.CREAR'));
	assert.ok(r.denies.includes('TURNOS.AGENDA.EDITAR'));
	assert.deepEqual(r.efectivos.sort(), efectivos.sort());

	svc._reiniciar(); // limpia cache de lectura
	const leidos = await svc.listarOverrides(103, 55);
	assert.deepEqual(leidos.grants.sort(), r.grants.sort());
	assert.deepEqual(leidos.denies.sort(), r.denies.sort());
});

test('guardar con efectivos = base borra overrides (sin filas)', async () => {
	reiniciar();
	const base = ['TURNOS.AGENDA.VER', 'TURNOS.AGENDA.CREAR'];
	const actor = { permisos: base };
	await svc.guardarDesdeEfectivos({
		idEmpresa: 1,
		valorPersonal: 2,
		base,
		efectivos: ['TURNOS.AGENDA.VER'],
		actor,
	});
	await svc.guardarDesdeEfectivos({
		idEmpresa: 1,
		valorPersonal: 2,
		base,
		efectivos: base,
		actor,
	});
	svc._reiniciar();
	assert.deepEqual(await svc.listarOverrides(1, 2), { grants: [], denies: [] });
});

test('permisos restringidos en efectivos se ignoran (no se persisten como GRANT)', async () => {
	reiniciar();
	const r = await svc.guardarDesdeEfectivos({
		idEmpresa: 1,
		valorPersonal: 2,
		base: [],
		efectivos: ['CONFIGURACION.ROLES.VER', 'TURNOS.AGENDA.VER'],
		actor: { permisos: ['CONFIGURACION.ROLES.VER', 'TURNOS.AGENDA.VER'] },
	});
	assert.ok(!r.grants.includes('CONFIGURACION.ROLES.VER'));
	assert.ok(r.grants.includes('TURNOS.AGENDA.VER'));
});
