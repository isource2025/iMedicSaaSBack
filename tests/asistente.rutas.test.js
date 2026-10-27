const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const rutasFront = require('../src/asistente/rutasFront');
const manual = require('../src/asistente/manual');
const { pathConocido } = require('../src/asistente/ejecutar');
const { sumasDeColumnas } = require('../src/asistente/sql');
const manifiesto = require('../src/asistente/manifiesto');

const DASHBOARD_FRONT = path.join(__dirname, '..', '..', 'iMedicSaaSFront', 'src', 'app', 'dashboard');

function paginasFront(dir, base = '/dashboard') {
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		const sub = path.join(dir, e.name);
		const ruta = `${base}/${e.name}`;
		if (fs.existsSync(path.join(sub, 'page.tsx'))) out.push(ruta);
		out.push(...paginasFront(sub, ruta));
	}
	return out;
}

test('la lista de rutas coincide con las páginas del front', { skip: !fs.existsSync(DASHBOARD_FRONT) }, () => {
	const reales = ['/dashboard', ...paginasFront(DASHBOARD_FRONT)]
		.filter((r) => !r.startsWith('/dashboard/super-admin') && !r.includes('['))
		.sort();
	assert.deepEqual([...rutasFront.RUTAS].sort(), reales);
});

test('links: rutas inventadas y prefijos de /dashboard no pasan', () => {
	assert.equal(pathConocido('/dashboard/consumo-ia'), false);
	assert.equal(pathConocido('/dashboard/inventada/123'), false);
	assert.equal(pathConocido('/dashboard/reports/ocupacion'), false);
	assert.equal(pathConocido('/dashboard/super-admin/empresas'), false);
	assert.equal(pathConocido('/dashboard/configuracion/consumo-ia'), true);
	assert.equal(pathConocido('/dashboard/beds/12?seccion=evoluciones'), true);
	assert.equal(pathConocido('/dashboard/visita/4512'), true);
	assert.equal(pathConocido('/dashboard'), true);
});

test('manual y listar_pantallas sólo ofrecen pantallas que existen', () => {
	for (const a of manual.ARTICULOS) assert.ok(rutasFront.existe(a.path), `artículo ${a.id}: ${a.path} no existe`);
	const pantallas = manual.pantallasDesdePermisos(['REPORTES.OCUPACION.VER', 'CONFIGURACION.CONSUMO_IA.VER']);
	assert.deepEqual(
		pantallas.map((p) => p.path),
		['/dashboard/configuracion/consumo-ia'],
	);
	assert.ok(manual.buscar('dashboard de consumo ia', 3).some((a) => a.id === 'consumo-ia'));
});

test('sql: sumas de columnas de cantidades, sin ids ni fechas', () => {
	const s = sumasDeColumnas([
		{ Sector: 'CM1', IdSector: 4, Internados: 7, FechaIngreso: 82400 },
		{ Sector: 'EME', IdSector: 9, Internados: 9, FechaIngreso: 82401 },
	]);
	assert.deepEqual(s, { Internados: 16 });
	assert.equal(sumasDeColumnas([{ Internados: 3 }]), null);
});

test('el índice de endpoints usa handler, JSDoc y descripción de permiso, no una tabla de sinónimos', () => {
	const paths = (texto, extra) => manifiesto.buscar({ texto, limite: 8, ...extra }).map((e) => e.path);
	assert.ok(paths('egreso', { metodo: 'POST' }).includes('/api/patients/visitas/egreso'));
	assert.ok(paths('registra el egreso de un paciente').includes('/api/patients/visitas/egreso'));
	assert.ok(paths('personal', { metodo: 'POST' }).includes('/api/personal'));
	const ep = manifiesto.resolver('POST', '/api/patients/visitas/egreso');
	const d = manifiesto.describir(ep);
	assert.match(d.para, /egreso/i);
	assert.equal(d.handler, 'registrarEgresoPaciente');
});
