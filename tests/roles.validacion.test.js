const test = require('node:test');
const assert = require('node:assert/strict');
const matriz = require('../src/utils/permisos');
const desc = require('../src/utils/permisosDescripciones');
const v = require('../src/utils/rolesValidacion');

// ─── Catálogo de descripciones ──────────────────────────────────────────────
test('todo submódulo del catálogo tiene descripción', () => {
	for (const m of matriz.MODULOS) {
		for (const s of m.submodulos) {
			assert.ok(desc.descripcionSubmodulo(m.id, s.id), `falta descripción de ${m.id}.${s.id}`);
		}
	}
});

test('todo permiso del catálogo resuelve una descripción no vacía', () => {
	for (const { codigo } of matriz.todosLosCodigos()) {
		assert.ok(desc.descripcionPermiso(codigo).length > 3, `sin descripción: ${codigo}`);
	}
});

test('las descripciones no apuntan a submódulos ni acciones inexistentes', () => {
	const codigos = new Set(matriz.todosLosCodigos().map((c) => c.codigo));
	for (const [clave, def] of Object.entries(desc.SUBMODULOS)) {
		const [mod, sub] = clave.split('.');
		const existe = matriz.MODULOS.some((m) => m.id === mod && m.submodulos.some((s) => s.id === sub));
		assert.ok(existe, `descripción de submódulo inexistente: ${clave}`);
		for (const acc of Object.keys(def.acciones || {})) {
			assert.ok(codigos.has(`${clave}.${acc}`), `descripción de permiso inexistente: ${clave}.${acc}`);
		}
	}
});

test('el catálogo para la pantalla excluye PLATAFORMA y marca los restringidos', () => {
	const cat = desc.catalogoConDescripciones();
	assert.ok(!cat.some((m) => m.id === 'PLATAFORMA'));
	const roles = cat.find((m) => m.id === 'CONFIGURACION').submodulos.find((s) => s.id === 'ROLES');
	assert.ok(roles.acciones.every((a) => a.asignable === false));
	const traslado = cat
		.find((m) => m.id === 'INTERNACION')
		.submodulos.find((s) => s.id === 'MOVIMIENTOS')
		.acciones.find((a) => a.accion === 'TRASLADAR');
	assert.equal(traslado.asignable, true);
});

test('ROLES sólo está en las plantillas ADMIN y SUPER_ADMIN', () => {
	for (const [rol, lista] of Object.entries(matriz.PLANTILLAS)) {
		const tiene = lista.some((c) => c.startsWith('CONFIGURACION.ROLES.'));
		assert.equal(tiene, rol === 'ADMIN' || rol === 'SUPER_ADMIN', `${rol}`);
	}
});

// ─── Nombres ────────────────────────────────────────────────────────────────
test('rechaza nombres reservados en cualquier variante', () => {
	for (const n of ['ADMIN', 'admin', ' Admin ', 'A.D.M.I.N', 'Super Admin', 'super_admin', 'Médico', 'MEDICO',
		'Enfermero', 'ENFERMERÍA', 'Carga HC', 'carga_hc', 'Carga de adjuntos', 'Panel de datos', 'PANEL_DATOS',
		'Administrativo', 'Plataforma']) {
		assert.equal(v.validarNombre(n).ok, false, `debería rechazar "${n}"`);
	}
});

test('acepta nombres válidos y los normaliza', () => {
	const r = v.validarNombre('  Enfermero   jefe  ');
	assert.equal(r.ok, true);
	assert.equal(r.nombre, 'Enfermero jefe');
	assert.equal(v.validarNombre('Enfermero + traslados').ok, true);
});

test('rechaza nombres muy cortos, largos o con caracteres raros', () => {
	assert.equal(v.validarNombre('ab').ok, false);
	assert.equal(v.validarNombre('x'.repeat(51)).ok, false);
	assert.equal(v.validarNombre('Rol<script>').ok, false);
	assert.equal(v.validarNombre("Rol'; DROP").ok, false);
});

test('rol base: solo valores permitidos y ADMIN nunca', () => {
	assert.equal(v.validarRolBase(undefined).rolBase, 'NINGUNO');
	assert.equal(v.validarRolBase('enfermero').rolBase, 'ENFERMERO');
	assert.equal(v.validarRolBase('ADMIN').ok, false);
	assert.equal(v.validarRolBase('SUPER_ADMIN').ok, false);
});

// ─── Permisos ───────────────────────────────────────────────────────────────
const admin = matriz.permisosDeRol('ADMIN');

test('rechaza códigos desconocidos', () => {
	const r = v.normalizarPermisos(['NO.EXISTE.VER'], { permisosActor: admin });
	assert.equal(r.ok, false);
});

test('rechaza permisos de plataforma y de roles', () => {
	assert.equal(v.normalizarPermisos(['PLATAFORMA.EMPRESAS.VER'], { permisosActor: matriz.permisosDeRol('SUPER_ADMIN') }).ok, false);
	assert.equal(v.normalizarPermisos(['CONFIGURACION.ROLES.EDITAR'], { permisosActor: admin }).ok, false);
});

test('el actor no puede otorgar permisos que no tiene', () => {
	const enfermero = matriz.permisosDeRol('ENFERMERO');
	const r = v.normalizarPermisos(['FACTURACION.CONVENIOS.VER'], { permisosActor: enfermero });
	assert.equal(r.ok, false);
	assert.match(r.errores[0], /no lo tenés/);
});

test('agrega VER automáticamente cuando se marca otra acción', () => {
	const r = v.normalizarPermisos(['INTERNACION.MOVIMIENTOS.TRASLADAR'], { permisosActor: admin });
	assert.equal(r.ok, true);
	assert.deepEqual(r.permisos, ['INTERNACION.MOVIMIENTOS.VER', 'INTERNACION.MOVIMIENTOS.TRASLADAR']);
	assert.deepEqual(r.agregados, ['INTERNACION.MOVIMIENTOS.VER']);
});

test('elimina duplicados y ordena según el catálogo', () => {
	const r = v.normalizarPermisos(
		['INTERNACION.CAMAS.EDITAR', 'INTERNACION.CAMAS.VER', 'INTERNACION.CAMAS.VER'],
		{ permisosActor: admin },
	);
	assert.deepEqual(r.permisos, ['INTERNACION.CAMAS.VER', 'INTERNACION.CAMAS.EDITAR']);
});

test('un submódulo sin acción VER no exige VER (p. ej. Nueva admisión)', () => {
	const r = v.normalizarPermisos(['ADMISION.NUEVA.CREAR'], { permisosActor: admin });
	assert.deepEqual(r.permisos, ['ADMISION.NUEVA.CREAR']);
});

test('entrada inválida no rompe', () => {
	assert.equal(v.normalizarPermisos('x').ok, false);
	assert.equal(v.normalizarPermisos(null).ok, false);
	assert.equal(v.normalizarPermisos([]).ok, true);
});
