const test = require('node:test');
const assert = require('node:assert/strict');
// Este archivo valida el paquete Internación; en runtime de prod va apagado (opt-in).
process.env.ASISTENTE_INTERNACION_LISTO = '1';
const orquestador = require('../src/asistente/agentes/orquestador');
const catalogo = require('../src/asistente/catalogo');
const contexto = require('../src/asistente/contexto');
const diagnostico = require('../src/asistente/diagnostico');
const { ejecutar } = require('../src/asistente/ejecutar');
const { construirSystemPrompt } = require('../src/asistente/prompt');
const permisosService = require('../src/services/permisos.service');
const matriz = require('../src/utils/permisos');

const internacionLista = () => Boolean(orquestador.porId('INTERNACION')?.LISTO);
const MEDICO = matriz.permisosDeRol('MEDICO');

function ctxDiag(extra) {
	return {
		permisos: MEDICO,
		tienePermiso: permisosService.tienePermiso,
		req: { rolNombre: 'MEDICO', headers: {} },
		pantalla: { errores: [] },
		navegaciones: [],
		pendientes: [],
		...extra,
	};
}

test('pedidos de soporte con palabras clínicas: ayuda, con Soporte e Internación cargados', () => {
	for (const t of [
		'no me deja guardar la evolución',
		'me da error al cargar un estudio',
		'por qué no veo el botón de egreso',
		'qué es una epicrisis',
		'cómo puedo trasladar a un paciente',
		'se me borró lo que escribí en la indicación',
		'cómo hago un traslado',
	]) {
		const r = orquestador.resolver({ texto: t });
		assert.equal(r.ayuda, true, t);
		assert.equal(r.pedido, 'SOPORTE', t);
		assert.equal(r.paquetes[0], 'SOPORTE', t);
		if (internacionLista()) assert.ok(r.paquetes.includes('INTERNACION'), `${t}: falta el paquete de Internación`);
		assert.deepEqual(r.avisos, [], t);
	}
});

test('«dónde está Sanabria» es un paciente aunque no esté en el mapa de camas', () => {
	const r = orquestador.resolver({ texto: 'dónde está Sanabria' });
	assert.equal(r.ayuda, false);
	assert.equal(r.pedido, 'INTERNACION');
	if (internacionLista()) assert.deepEqual(r.paquetes, ['SOPORTE', 'INTERNACION']);
	for (const t of ['cómo está Gómez', 'cómo sigue la de la 105', 'pasame lo del de la 12']) {
		const x = orquestador.resolver({ texto: t });
		assert.equal(x.ayuda, false, t);
		assert.equal(x.pedido, 'INTERNACION', t);
	}
	assert.equal(orquestador.resolver({ texto: 'dónde está la pantalla de turnos' }).ayuda, true);
	assert.equal(orquestador.resolver({ texto: 'dónde está la pantalla de turnos' }).pedido, 'SOPORTE');
});

test('Soporte va siempre; sticky y foco mantienen Internación sin cambio de tema', { skip: !internacionLista() }, () => {
	assert.deepEqual(orquestador.resolver({ texto: 'hola' }).paquetes, ['SOPORTE']);
	const seguido = orquestador.resolver({ texto: 'y los de ayer?', paquetesActivos: ['SOPORTE', 'INTERNACION'] });
	assert.deepEqual(seguido.paquetes, ['SOPORTE', 'INTERNACION']);
	assert.equal(seguido.id, 'INTERNACION');
	const conFoco = orquestador.resolver({ texto: 'resumime todo', foco: { numeroVisita: 458887 } });
	assert.ok(conFoco.paquetes.includes('INTERNACION'));
	const porRuta = orquestador.resolver({ texto: 'qué hay acá', moduloRuta: 'INTERNACION' });
	assert.ok(porRuta.paquetes.includes('INTERNACION'));
});

test('módulo no activo: aviso si es una acción, nada si es ayuda', () => {
	const accion = orquestador.resolver({ texto: 'dame un turno para mañana con el cardiólogo' });
	assert.deepEqual(accion.paquetes, ['SOPORTE']);
	assert.deepEqual(accion.avisos, ['TURNOS']);
	assert.equal(accion.id, 'SOPORTE');
	const ayuda = orquestador.resolver({ texto: 'cómo doy un turno' });
	assert.deepEqual(ayuda.avisos, []);
	assert.match(orquestador.instrucciones(accion), /Turnos: eso todavía no se opera desde el chat/);
});

test('catálogo con paquetes: Soporte + Internación sin duplicados ni escrituras bloqueadas', { skip: !internacionLista() }, () => {
	const antes = process.env.ASISTENTE_INTERNACION_ESCRITURA;
	delete process.env.ASISTENTE_INTERNACION_ESCRITURA;
	try {
		const names = catalogo
			.seleccionar({
				permisos: MEDICO,
				paquetes: ['SOPORTE', 'INTERNACION'],
				tienePermiso: permisosService.tienePermiso,
			})
			.map((h) => h.name);
		assert.equal(new Set(names).size, names.length, 'tool duplicada');
		for (const n of ['buscar_en_manual', 'diagnosticar', 'navegar', 'buscar_internado', 'ver_estudios', 'preparar_evolucion']) {
			assert.ok(names.includes(n), `falta ${n}`);
		}
		for (const n of ['preparar_egreso', 'trasladar_cama', 'eliminar_evolucion']) {
			assert.ok(!names.includes(n), `${n} ofrecida en modo altas`);
		}
		assert.ok(names.length <= catalogo.MAX_TOOLS);
	} finally {
		if (antes === undefined) delete process.env.ASISTENTE_INTERNACION_ESCRITURA;
		else process.env.ASISTENTE_INTERNACION_ESCRITURA = antes;
	}
});

test('instrucciones compuestas: capa de ayuda + sección del módulo', { skip: !internacionLista() }, () => {
	const ruta = orquestador.resolver({ texto: 'no me deja guardar la evolución' });
	const txt = orquestador.instrucciones(ruta);
	assert.match(txt, /## Ayuda y soporte/);
	assert.match(txt, /diagnosticar/);
	assert.match(txt, /## Módulo INTERNACION/);
	assert.match(txt, /pedido de AYUDA/);
	assert.doesNotMatch(txt, /en construcción/);
	assert.match(orquestador.instrucciones({}), /español rioplatense/);
});

test('diagnosticar: permiso que tiene, permiso que falta y quién lo habilita', () => {
	const egreso = diagnostico.diagnosticar({ accion: 'egresar un paciente' }, ctxDiag());
	assert.equal(egreso.conclusion, 'tiene_los_permisos');
	assert.equal(egreso.permisos[0].codigo, 'INTERNACION.MOVIMIENTOS.GESTIONAR');

	const exportar = diagnostico.diagnosticar({ accion: 'exportar la tabla de internación' }, ctxDiag());
	assert.equal(exportar.conclusion, 'falta_permiso');
	assert.deepEqual(exportar.permisos.map((p) => p.codigo), ['INTERNACION.TABLA.EXPORTAR']);
	assert.match(exportar.proximoPaso, /administrador.*Matriz de permisos.*MEDICO/);

	const admin = diagnostico.diagnosticar(
		{ accion: 'exportar la tabla de internación' },
		ctxDiag({ permisos: [...MEDICO, 'CONFIGURACION.ROLES.EDITAR'] }),
	);
	assert.match(admin.proximoPaso, /Vos mismo/);
});

test('diagnosticar: el error de la pantalla manda sobre la adivinanza', () => {
	const conCodigo = diagnostico.diagnosticar(
		{ accion: 'ver la tabla' },
		ctxDiag({ pantalla: { errores: [{ metodo: 'GET', path: '/api/x', status: 403, mensaje: 'Permiso requerido: INTERNACION.TABLA.EXPORTAR' }] } }),
	);
	assert.equal(conCodigo.conclusion, 'falta_permiso');
	assert.equal(conCodigo.permisos[0].codigo, 'INTERNACION.TABLA.EXPORTAR');
	assert.equal(conCodigo.permisos[0].segun, 'error');

	const ajeno = diagnostico.diagnosticar(
		{ accion: 'borrar una evolución' },
		ctxDiag({
			pantalla: {
				errores: [{ status: 403, mensaje: 'Por restricciones legales, no puede modificar registros creados por otro profesional.' }],
			},
		}),
	);
	assert.equal(ajeno.conclusion, 'registro_ajeno');
	assert.match(ajeno.proximoPaso, /No es un problema de permisos/);

	const servidor = diagnostico.diagnosticar({ accion: 'guardar evolución' }, ctxDiag({ pantalla: { errores: [{ status: 500 }] } }));
	assert.equal(servidor.conclusion, 'servidor');
	assert.match(servidor.proximoPaso, /avisar a soporte/);

	const dicho = diagnostico.diagnosticar({ accion: 'guardar', error: 'Sesión expirada por inactividad' }, ctxDiag());
	assert.equal(dicho.conclusion, 'sesion');
});

test('diagnosticar corre por ejecutar sin HTTP', async () => {
	const out = await ejecutar('diagnosticar', { accion: 'cargar una evolución' }, ctxDiag());
	assert.equal(out.conclusion, 'tiene_los_permisos');
	assert.ok(out.permisos.some((p) => p.codigo === 'INTERNACION.EVOLUCIONES.CREAR' && p.tiene));
});

test('errores, avisos y botones deshabilitados de la pantalla: saneados y en el prompt', () => {
	const p = contexto.pantallaDeBody({
		url: '/dashboard/beds/4',
		errores: [
			{ metodo: 'post', path: '/api/evoluciones', status: 403, mensaje: 'Permiso requerido: INTERNACION.EVOLUCIONES.CREAR', haceSeg: 40 },
			{ metodo: 'GET', path: 'https://evil.com/x', status: 500 },
			{ metodo: 'DROP', path: '/api/x', status: 9999, mensaje: 'm'.repeat(500) },
		],
		alertas: ['No se pudo guardar'],
		deshabilitados: ['Egresar (Requiere permiso de gestión)'],
	});
	assert.equal(p.errores.length, 2);
	assert.equal(p.errores[0].metodo, 'POST');
	assert.equal(p.errores[1].metodo, 'GET');
	assert.equal(p.errores[1].status, 0);
	assert.equal(p.errores[1].mensaje.length, 200);
	const prompt = construirSystemPrompt({ rol: 'MEDICO', pantalla: p });
	assert.match(prompt, /POST \/api\/evoluciones → 403 «Permiso requerido: INTERNACION.EVOLUCIONES.CREAR» \(hace 40 s\)/);
	assert.match(prompt, /Avisos visibles: «No se pudo guardar»/);
	assert.match(prompt, /Botones deshabilitados: Egresar/);
});

test('ayuda sin carga: Internación viaja liviana (tools de verificación y reglas cortas)', { skip: !internacionLista() }, () => {
	const ruta = orquestador.resolver({ texto: '¿cómo cargo una evolución?', moduloRuta: 'INTERNACION' });
	ruta.escribe = false;
	assert.equal(orquestador.soloAyuda(ruta), true);
	const opts = { permisos: MEDICO, paquetes: ruta.paquetes, tienePermiso: permisosService.tienePermiso, soloLectura: true };
	const nombres = catalogo.seleccionar({ ...opts, ayuda: true }).map((h) => h.name);
	assert.ok(nombres.includes('buscar_en_manual') && nombres.includes('diagnosticar'));
	assert.ok(nombres.includes('ver_evoluciones') && nombres.includes('buscar_internado'));
	assert.ok(!nombres.includes('ver_historia_clinica') && !nombres.includes('resumen_internacion'));
	assert.ok(catalogo.seleccionar(opts).some((h) => h.name === 'ver_historia_clinica'));
	const corto = orquestador.instrucciones(ruta, { conNotas: false });
	const largo = orquestador.instrucciones({ ...ruta, ayuda: false }, { conNotas: false });
	assert.match(corto, /habilitar_modulo/);
	assert.ok(corto.length < largo.length / 2);
	assert.equal(orquestador.soloAyuda({ ...ruta, escribe: true }), false);
});

test('buscar_en_manual deja botones a la pantalla y señala la opción', async () => {
	const ctx = ctxDiag({ req: { rolNombre: 'MEDICO', headers: {}, body: { mensaje: 'cómo traslado a un paciente de cama', rutaActual: '/dashboard' } } });
	await ejecutar('buscar_en_manual', { pregunta: 'trasladar paciente de cama' }, ctx);
	const traslado = ctx.navegaciones.find((n) => n.resaltar === 'Cambiar Cama');
	assert.ok(traslado, JSON.stringify(ctx.navegaciones));
	assert.equal(traslado.path, '/dashboard/beds');
	assert.ok(ctx.navegaciones.length <= 2);
});

test('buscar_en_manual con una visita abierta: el botón abre esa sección de la ficha', async () => {
	const ruta = '/dashboard/visita/458887';
	const ctx = ctxDiag({
		entidades: { numeroVisita: 458887 },
		req: { rolNombre: 'MEDICO', headers: {}, body: { mensaje: 'cómo cargo una evolución', rutaActual: ruta } },
	});
	await ejecutar('buscar_en_manual', { pregunta: 'cargar evolución' }, ctx);
	assert.ok(
		ctx.navegaciones.some((n) => n.href === '/dashboard/visita/458887?seccion=evoluciones'),
		JSON.stringify(ctx.navegaciones),
	);
});
