/**
 * Auditoria general (imAuditoria): normalizacion de banderas, escritura segura
 * y filtros de lectura. Sin base de datos (pool simulado).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const src = (p) => path.join(__dirname, '..', 'src', p);

const consultas = [];
let existeTabla = true;
let filasListar = [];
let habilitado = true;

const dbPath = require.resolve(src('config/authCentralDb.js'));
require.cache[dbPath] = {
	id: dbPath,
	filename: dbPath,
	loaded: true,
	exports: {
		isAuthCentralEnabled: () => habilitado,
		getAuthCentralPool: async () => ({
			query: async (sql, params = []) => {
				consultas.push({ sql, params });
				if (/information_schema\.TABLES/.test(sql)) return [existeTabla ? [{ ok: 1 }] : []];
				if (/FROM imAuditoria/.test(sql)) return [filasListar];
				return [[]];
			},
		}),
	},
};

const auditoria = require(src('services/auditoria.service.js'));

function reiniciar() {
	consultas.length = 0;
	existeTabla = true;
	filasListar = [];
	habilitado = true;
	auditoria._reiniciarCache();
}

const insertadas = () => consultas.filter((c) => /INSERT INTO imAuditoria/.test(c.sql));

test('registrar normaliza las banderas y guarda el detalle como JSON', async () => {
	reiniciar();
	await auditoria.registrar(null, {
		idEmpresa: 3,
		modulo: 'roles',
		entidad: ' rol ',
		idEntidad: 1001,
		accion: 'editar',
		actor: 55,
		detalle: { nombre: { de: 'a', a: 'b' } },
	});
	const [ins] = insertadas();
	assert.ok(ins);
	// IdEmpresa, Modulo, Entidad, IdEntidad, Accion, Actor, Ip, Detalle
	assert.deepEqual(ins.params.slice(0, 6), [3, 'ROLES', 'ROL', '1001', 'EDITAR', 55]);
	assert.equal(ins.params[6], null);
	assert.deepEqual(JSON.parse(ins.params[7]), { nombre: { de: 'a', a: 'b' } });
});

test('registrar exige modulo, entidad, accion y una empresa valida', async () => {
	reiniciar();
	await assert.rejects(() => auditoria.registrar(null, { idEmpresa: 1, entidad: 'X', accion: 'Y' }));
	await assert.rejects(() => auditoria.registrar(null, { idEmpresa: 1, modulo: 'X', accion: 'Y' }));
	await assert.rejects(() => auditoria.registrar(null, { idEmpresa: 1, modulo: 'X', entidad: 'Y' }));
	await assert.rejects(() => auditoria.registrar(null, { idEmpresa: 'abc', modulo: 'X', entidad: 'Y', accion: 'Z' }));
	assert.equal(insertadas().length, 0);
});

test('con conexion de transaccion usa esa conexion (no el pool)', async () => {
	reiniciar();
	const llamadas = [];
	const conn = { query: async (sql, params) => llamadas.push({ sql, params }) };
	await auditoria.registrar(conn, { idEmpresa: 1, modulo: 'M', entidad: 'E', accion: 'A' });
	assert.equal(llamadas.length, 1);
	assert.equal(insertadas().length, 0);
});

test('registrarSeguro no escribe ni falla si la tabla todavia no existe', async () => {
	reiniciar();
	existeTabla = false;
	const r = await auditoria.registrarSeguro({ idEmpresa: 1, modulo: 'M', entidad: 'E', accion: 'A' });
	assert.equal(r, false);
	assert.equal(insertadas().length, 0);
});

test('registrarSeguro no propaga errores de datos invalidos', async () => {
	reiniciar();
	const r = await auditoria.registrarSeguro({ idEmpresa: 1, modulo: '', entidad: 'E', accion: 'A' });
	assert.equal(r, false);
});

test('registrarSeguro registra cuando la tabla existe', async () => {
	reiniciar();
	const r = await auditoria.registrarSeguro({ idEmpresa: 1, modulo: 'M', entidad: 'E', accion: 'A' });
	assert.equal(r, true);
	assert.equal(insertadas().length, 1);
});

test('sin autenticacion central no hay esquema ni historial', async () => {
	reiniciar();
	habilitado = false;
	assert.equal(await auditoria.esquemaListo(), false);
	assert.deepEqual(await auditoria.listar({ idEmpresa: 1 }), []);
	await assert.rejects(() => auditoria.asegurarEsquema(), /autenticaci/);
});

test('listar siempre acota por empresa y aplica los filtros pedidos', async () => {
	reiniciar();
	await auditoria.listar({ idEmpresa: 9, modulo: 'roles', entidad: 'rol', idEntidad: 1001, actor: 4, limite: 20 });
	const q = consultas.find((c) => /FROM imAuditoria/.test(c.sql));
	assert.match(q.sql, /a\.IdEmpresa = \?/);
	assert.deepEqual(q.params, [9, 'ROLES', 'ROL', '1001', 4, 20]);
});

test('listar limita el maximo de filas y parsea el detalle', async () => {
	reiniciar();
	filasListar = [
		{ id: 1, modulo: 'ROLES', entidad: 'ROL', idEntidad: '1', accion: 'CREAR', actor: 2, fecha: '2026-01-01', ip: null, detalle: '{"x":1}', actorNombre: ' Ana ' },
		{ id: 2, modulo: 'ROLES', entidad: 'ROL', idEntidad: '1', accion: 'EDITAR', actor: null, fecha: '2026-01-02', ip: null, detalle: 'no-json', actorNombre: null },
	];
	const r = await auditoria.listar({ idEmpresa: 1, limite: 999999 });
	const q = consultas.find((c) => /FROM imAuditoria/.test(c.sql));
	assert.equal(q.params.at(-1), 500);
	assert.deepEqual(r[0].detalle, { x: 1 });
	assert.equal(r[0].actorNombre, 'Ana');
	assert.equal(r[1].detalle, null);
	assert.equal(r[1].actor, null);
});

test('asegurarEsquema crea imAuditoria (una sola vez aunque se llame en paralelo)', async () => {
	reiniciar();
	await Promise.all([auditoria.asegurarEsquema(), auditoria.asegurarEsquema()]);
	await auditoria.asegurarEsquema();
	const creaciones = consultas.filter((c) => /CREATE TABLE IF NOT EXISTS `imAuditoria`/.test(c.sql));
	assert.equal(creaciones.length, 1);
});

test('el esquema de roles ya no crea una tabla de auditoria propia', () => {
	const fs = require('fs');
	const schema = fs.readFileSync(src('services/rolesCustomSchema.service.js'), 'utf8');
	const roles = fs.readFileSync(src('services/rolesCustom.service.js'), 'utf8');
	assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS[^;]*imRolesAuditoria/);
	assert.doesNotMatch(roles, /FROM imRolesAuditoria|INTO imRolesAuditoria/);
});
