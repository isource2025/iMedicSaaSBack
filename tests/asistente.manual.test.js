const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const manual = require('../src/asistente/manual');
const rutasFront = require('../src/asistente/rutasFront');
const { todosLosCodigos } = require('../src/utils/permisos');
const { tienePermiso } = require('../src/services/permisos.service');
const diagnostico = require('../src/asistente/diagnostico');
const { ejecutar } = require('../src/asistente/ejecutar');

/** Pantallas sin contenido propio: un stub y dos redirecciones. */
const SIN_ARTICULO = new Set(['/dashboard/bed-detail', '/dashboard/turnos/bandeja-pedidos', '/dashboard/turnos/bot']);

const SECCIONES_FRONT = path.join(__dirname, '..', '..', 'iMedicSaaSFront', 'src', 'app', 'components', 'beds', 'seccionesUrl.ts');

test('cada pantalla real tiene al menos un artículo', () => {
	const cubiertas = new Set(manual.ARTICULOS.map((a) => a.path));
	const faltan = rutasFront.RUTAS.filter((r) => !SIN_ARTICULO.has(r) && !cubiertas.has(r));
	assert.deepEqual(faltan, [], `pantallas sin artículo: ${faltan.join(', ')}`);
});

test('artículos: ids únicos, campos completos, paths y permisos reales', () => {
	const codigos = new Set(todosLosCodigos().map((c) => c.codigo));
	const ids = new Set();
	for (const a of manual.ARTICULOS) {
		assert.ok(!ids.has(a.id), `id repetido: ${a.id}`);
		ids.add(a.id);
		for (const k of ['titulo', 'path', 'modulo', 'comoLlegar', 'texto']) assert.ok(a[k], `${a.id}: falta ${k}`);
		assert.ok(Array.isArray(a.tags) && a.tags.length, `${a.id}: sin tags`);
		assert.ok(Array.isArray(a.permisos), `${a.id}: permisos tiene que ser lista`);
		assert.ok(rutasFront.existe(a.path), `${a.id}: ${a.path} no existe en el front`);
		for (const c of a.permisos) assert.ok(codigos.has(c), `${a.id}: el permiso ${c} no existe en la matriz`);
		for (const p of a.problemas || []) assert.ok(p.sintoma && p.causa, `${a.id}: problema incompleto`);
	}
});

test('las secciones de la ficha existen en el front', { skip: !fs.existsSync(SECCIONES_FRONT) }, () => {
	const fuente = fs.readFileSync(SECCIONES_FRONT, 'utf8');
	const validas = new Set([...fuente.matchAll(/'([\w-]+)'/g)].map((m) => m[1]));
	for (const a of manual.ARTICULOS.filter((x) => x.seccion && x.path === '/dashboard/beds')) {
		assert.ok(validas.has(a.seccion), `${a.id}: sección ${a.seccion} no está en seccionesUrl.ts`);
	}
});

test('ranking: preguntas reales de usuarios encuentran el artículo correcto primero', () => {
	const casos = [
		['cómo ver camas', 'camas'],
		['cómo doy un turno', 'agenda'],
		['quiero reprogramar un turno', 'agenda'],
		['cómo le doy el alta a un paciente', 'egreso'],
		['se me borró la evolución que cargué ayer', 'hc-periodo'],
		['no me deja borrar la indicación', 'hc-indicaciones'],
		['cómo cambio mi contraseña', 'perfil'],
		['cómo creo un rol nuevo', 'matriz-permisos'],
		['cómo paso a un paciente a otra cama', 'traslado'],
		['cómo pido una tomografía', 'hc-estudios'],
		['cómo cargo la presión', 'hc-controles'],
		['me sacó del sistema', 'sesion'],
		['cómo hago un pedido a almacén', 'almacen-solicitudes'],
		['cómo cargo los horarios del médico', 'config-turnos'],
		['cómo doy de alta un médico nuevo', 'personal'],
		['revertir egreso', 'revertir-egreso'],
		['cómo admitir un paciente', 'nueva-admision'],
		['dashboard de consumo ia', 'consumo-ia'],
	];
	for (const [q, id] of casos) {
		const hits = manual.buscar(q, 3);
		assert.equal(hits[0]?.id, id, `«${q}» → ${hits.map((h) => h.id).join(', ')}`);
	}
});

test('raíces y sinónimos: plural, verbo y palabra del usuario', () => {
	const { raiz, terminosDe } = manual._interno;
	assert.equal(raiz('evoluciones'), raiz('evolución'.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
	assert.equal(raiz('indicaciones'), raiz('indicar'));
	assert.equal(raiz('camas'), raiz('cama'));
	assert.ok(terminosDe('olvidé la clave').has(raiz('contrasena')));
	assert.equal(manual.buscar('de la que por', 3).length, 0);
});

test('la sección abierta en pantalla gana en preguntas genéricas', () => {
	assert.equal(manual.buscar('cómo cargo', 3, { ruta: '/dashboard/beds/12?seccion=dieta' })[0].id, 'hc-dieta');
	assert.equal(manual.buscar('agregar', 3, { ruta: '/dashboard/visita/458887?seccion=evoluciones' })[0].id, 'hc-evoluciones');
	assert.equal(manual.buscar('no me deja', 3, { ruta: '/dashboard/beds/3?seccion=epicrisis' })[0].id, 'hc-epicrisis');
});

test('accesible marca lo que el usuario no tiene, sin ocultarlo', () => {
	const sin = manual.buscar('cómo creo un rol nuevo', 1, { permisos: ['INTERNACION.CAMAS.VER'] });
	assert.equal(sin[0].accesible, false);
	const con = manual.buscar('cómo creo un rol nuevo', 1, { tienePermiso: (c) => c === 'CONFIGURACION.ROLES.VER' });
	assert.equal(con[0].accesible, true);
	assert.equal(manual.buscar('cómo creo un rol nuevo', 1)[0].accesible, undefined);
});

test('paraModelo: el primero con pasos y problemas, todo dentro del tope', () => {
	const hits = manual.buscar('cómo doy un turno', 4, { permisos: [] });
	const out = manual.paraModelo(hits, 2500);
	assert.ok(out[0].pasos?.length && out[0].problemas?.length);
	assert.ok(JSON.stringify(out).length <= 2500 || out.length === 1);
	assert.ok(out.every((a) => rutasFront.existe(a.path)));
	assert.ok(out[0].permisos, 'sin acceso: incluye qué permisos pide');
});

test('ejecutar buscar_en_manual usa la pantalla y los permisos del usuario', async () => {
	const ctx = {
		permisos: ['INTERNACION.CAMAS.VER', 'INTERNACION.DIETA.VER'],
		tienePermiso,
		pantalla: { url: '/dashboard/beds/7?seccion=dieta' },
		navegaciones: [],
	};
	const r = await ejecutar('buscar_en_manual', { pregunta: 'cómo cargo' }, ctx);
	assert.equal(r.articulos[0].id, 'hc-dieta');
	assert.equal(r.articulos[0].accesible, true);
	const vacio = await ejecutar('buscar_en_manual', { pregunta: 'de la que' }, { ...ctx, pantalla: null });
	assert.equal(vacio.articulos.length, 0);
	assert.match(vacio.aviso, /no inventes/);
});

test('buscar_en_manual: si el modelo reescribe la pregunta, gana lo que dijo el usuario', async () => {
	const ctx = {
		permisos: [],
		tienePermiso,
		pantalla: { url: '/dashboard/visita/458887?seccion=dieta' },
		req: { body: { mensaje: 'cómo cargo acá?' } },
		navegaciones: [],
	};
	const r = await ejecutar('buscar_en_manual', { pregunta: 'cómo cargar una evolución' }, ctx);
	assert.equal(r.articulos[0].id, 'hc-dieta');
	assert.ok(r.articulos.some((a) => a.id === 'hc-evoluciones'));
});

test('diagnosticar suma los problemas frecuentes del manual y no confunde texto libre con falla de red', () => {
	const r = diagnostico.diagnosticar(
		{ accion: 'se me borró la evolución que cargué ayer', error: 'se me borró' },
		{ permisos: ['INTERNACION.EVOLUCIONES.VER'], tienePermiso, pantalla: { url: '/dashboard/visita/1?seccion=evoluciones' } },
	);
	assert.notEqual(r.conclusion, 'red');
	assert.ok(r.manual.problemas.some((p) => /per[ií]odo/i.test(p.causa)));
});

test('diagnosticar: un permiso que no existe en la matriz va a soporte técnico, no al admin', () => {
	const r = diagnostico.diagnosticar(
		{ accion: 'crear un sector', error: 'Permiso requerido: CONFIGURACION.SECTORES.CREAR' },
		{ permisos: [], tienePermiso },
	);
	assert.equal(r.conclusion, 'permiso_inexistente');
	assert.match(r.proximoPaso, /soporte técnico/);
	assert.ok(!r.permisos.some((p) => p.codigo === 'CONFIGURACION.SECTORES.CREAR'));
});
