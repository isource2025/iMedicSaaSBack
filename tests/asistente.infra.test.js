const test = require('node:test');
const assert = require('node:assert/strict');
const manifiesto = require('../src/asistente/manifiesto');
const sqlLectura = require('../src/asistente/sql');
const clinica = require('../src/asistente/clinica');
const { ejecutar } = require('../src/asistente/ejecutar');
const catalogo = require('../src/asistente/catalogo');
const pendientes = require('../src/asistente/pendientes');
const permisosService = require('../src/services/permisos.service');
const marca = require('../src/asistente/marca');
const contexto = require('../src/asistente/contexto');
const { construirSystemPrompt } = require('../src/asistente/prompt');
const autoria = require('../src/asistente/autoria');
const recortar = require('../src/asistente/recortar');

function ctxBase(extra) {
	return {
		permisos: ['INTERNACION.EVOLUCIONES.VER', 'INTERNACION.EVOLUCIONES.CREAR'],
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: 1,
		valorPersonal: 10,
		token: 't',
		req: { headers: {}, rolNombre: 'ENFERMERO' },
		navegaciones: [],
		pendientes: [],
		consultas: [],
		...extra,
	};
}

test('manifiesto lee rutas reales con permisos y excluye auth', () => {
	const eps = manifiesto.obtener();
	assert.ok(eps.length > 100, `pocos endpoints: ${eps.length}`);
	assert.ok(!eps.some((e) => e.path.startsWith('/api/auth')));
	assert.ok(!eps.some((e) => e.path.startsWith('/api/asistente')));

	const ev = manifiesto.resolver('POST', '/api/evoluciones');
	assert.ok(ev);
	assert.deepEqual(ev.permisos, ['INTERNACION.EVOLUCIONES.CREAR']);
	assert.equal(ev.mutante, true);

	const byDate = manifiesto.resolver('GET', '/api/evoluciones/123/byDate?date=2026-01-01');
	assert.equal(byDate.path, '/api/evoluciones/:idVisita/byDate');
	assert.equal(manifiesto.resolver('POST', '/api/auth/login'), null);
});

test('describir_endpoint expone los campos que lee el controller', () => {
	const d = manifiesto.describir(manifiesto.resolver('POST', '/api/evoluciones'), true);
	for (const campo of ['IdVisita', 'FechaEv', 'HoraEv', 'Evolucion']) assert.ok(d.campos.body.includes(campo), campo);
});

test('validar SQL solo deja pasar lecturas seguras', () => {
	assert.equal(sqlLectura.validar('SELECT TOP 10 * FROM imVisita').ok, true);
	assert.equal(sqlLectura.validar('WITH x AS (SELECT 1 AS a) SELECT a FROM x;').ok, true);
	assert.equal(sqlLectura.validar("SELECT 'delete; drop' AS texto").ok, true);

	const rechazos = [
		'UPDATE imVisita SET Egreso = 1',
		'SELECT * INTO copia FROM imVisita',
		'SELECT 1; DROP TABLE imVisita',
		'SELECT * FROM imPassword',
		'SELECT Token FROM imUsuarios',
		'SELECT * FROM sys.tables',
		'EXEC sp_who',
		'DELETE FROM imCamas',
		'',
	];
	for (const q of rechazos) assert.equal(sqlLectura.validar(q).ok, false, q);
});

test('puedeUsarSql por rol o por permiso explícito', () => {
	assert.equal(sqlLectura.puedeUsarSql('ADMIN', []), true);
	assert.equal(sqlLectura.puedeUsarSql('ENFERMERO', []), false);
	assert.equal(sqlLectura.puedeUsarSql('ENFERMERO', ['ASISTENTE.SQL.VER']), true);
});

test('Soporte no expone SQL aunque el rol pueda', () => {
	const sinSql = catalogo.seleccionar({
		permisos: ['INTERNACION.EVOLUCIONES.VER'],
		agente: 'SOPORTE',
		tienePermiso: permisosService.tienePermiso,
		puedeSql: false,
	});
	assert.ok(!sinSql.some((h) => h.name === 'consulta_sql'));
	const conSql = catalogo.seleccionar({
		permisos: ['INTERNACION.EVOLUCIONES.VER'],
		agente: 'SOPORTE',
		tienePermiso: permisosService.tienePermiso,
		puedeSql: true,
	});
	assert.ok(!conSql.some((h) => h.name === 'consulta_sql'));
	assert.ok(catalogo.porNombre('consulta_sql'));
});

test('consulta_sql se niega sin rol habilitado', async () => {
	const out = await ejecutar('consulta_sql', { sql: 'SELECT 1' }, ctxBase());
	assert.match(out.error, /SQL/);
});

test('navegar abre la ficha de visita en una sección', async () => {
	assert.equal(clinica.linkSeccion(321, 'controles-frecuentes'), '/dashboard/visita/321?seccion=controles-frecuentes');
	const ctx = ctxBase();
	const out = await ejecutar(
		'navegar',
		{
			path: '/dashboard/visita/321',
			query: { seccion: 'controles-frecuentes' },
			motivo: 'Pérez · controles',
		},
		ctx,
	);
	assert.equal(out.ok, true);
	assert.equal(ctx.navegaciones[0].href, '/dashboard/visita/321?seccion=controles-frecuentes');
	assert.match(ctx.navegaciones[0].motivo, /Pérez/);
});

const REQ = { auth: { usuario: { nombre: 'Ana', apellido: 'García' } }, matricula: 4521, valorPersonal: 10 };

test('marca generativa firma con el usuario que valida y no se duplica', () => {
	const f = new Date(2026, 9, 10, 8, 45);
	const t = marca.marcar('Paciente estable.', REQ, f);
	assert.equal(t, 'Paciente estable.\n\n[IA iMedic] Redactado con asistente IA · validado por García, Ana (Mat. 4521) el 10/10/2026 08:45');
	assert.equal(marca.marcar(t, REQ, f), t);
	const body = marca.marcarBody({ Evolucion: 'Paciente estable, afebril.', IdVisita: 3 }, ['Evolucion', 'IdVisita'], REQ, f);
	assert.ok(marca.tieneMarca(body.Evolucion));
	assert.equal(body.IdVisita, 3);
});

test('marca: nunca toca datos (fechas, documento, nombre, domicilio)', () => {
	const f = new Date(2026, 9, 10, 18, 47);
	const datos = {
		FechaNacimiento: '1996-10-09',
		NumeroDocumento: '39863295',
		ApellidoNombre: 'De Biasi Maidana, Emiliano Martin',
		Domicilio: 'MZA E CASA 9',
		Observaciones: 'Ingresa por guardia para control post quirúrgico.',
		Otro: '10/10/2026',
	};
	const out = marca.marcarBody(datos, Object.keys(datos), REQ, f);
	assert.equal(out.FechaNacimiento, '1996-10-09');
	assert.equal(out.NumeroDocumento, '39863295');
	assert.equal(out.ApellidoNombre, datos.ApellidoNombre);
	assert.equal(out.Domicilio, datos.Domicilio);
	assert.equal(out.Otro, '10/10/2026');
	assert.ok(marca.tieneMarca(out.Observaciones));
	assert.deepEqual(marca.camposMarcables(datos, Object.keys(datos)), ['Observaciones']);
});

test('pantallaDeBody acota y descarta ids inválidos', () => {
	const p = contexto.pantallaDeBody({
		url: '/dashboard/beds/4?seccion=evoluciones',
		campos: [
			{ id: 'c1', etiqueta: 'Evolución Médica', multilinea: true, valor: '' },
			{ id: '"><script>', etiqueta: 'malo' },
			{ id: 'c2', etiqueta: 'x'.repeat(500), valor: 'y'.repeat(2000) },
		],
		seleccion: 'texto elegido',
	});
	assert.equal(p.campos.length, 2);
	assert.equal(p.campos[0].vacio, true);
	assert.equal(p.campos[1].etiqueta.length, 80);
	assert.equal(p.campos[1].valor.length, 400);
	const prompt = construirSystemPrompt({ rol: 'MEDICO', pantalla: p, permisosResumen: 'INTERNACION: EVOLUCIONES.VER' });
	assert.match(prompt, /c1 «Evolución Médica» \(texto largo\) — vacío/);
	assert.match(prompt, /texto elegido/);
	assert.match(prompt, /INTERNACION: EVOLUCIONES.VER/);
});

test('escribir_en_campo crea una sugerencia y no un pendiente HTTP', async () => {
	pendientes.resetStore();
	const pantalla = contexto.pantallaDeBody({ campos: [{ id: 'c1', etiqueta: 'Evolución Médica', multilinea: true }] });
	const ctx = ctxBase({ pantalla, inserciones: [] });
	const out = await ejecutar('escribir_en_campo', { campoId: 'c1', texto: 'Paciente estable.' }, ctx);
	assert.equal(out.requiereConfirmacion, true);
	assert.equal(ctx.inserciones.length, 1);
	assert.equal(ctx.pendientes.length, 0);
	const item = pendientes.peek(out.idInsercion, 1, 10);
	assert.equal(item.tipo, 'insercion');
	assert.equal(item.insercion.multilinea, true);

	const malo = await ejecutar('escribir_en_campo', { campoId: 'c9', texto: 'x' }, ctxBase({ pantalla, inserciones: [] }));
	assert.match(malo.error, /c1 \(Evolución Médica\)/);
});

test('llamar_api marca como generativos los campos declarados', async () => {
	pendientes.resetStore();
	const ctx = ctxBase();
	await ejecutar(
		'llamar_api',
		{
			metodo: 'POST',
			path: '/api/evoluciones',
			body: { Evolucion: 'Paciente estable, afebril.', FechaEv: '2026-10-10' },
			camposGenerados: ['Evolucion', 'FechaEv'],
		},
		ctx,
	);
	assert.equal(ctx.pendientes[0].generativo, true);
	assert.deepEqual(pendientes.peek(ctx.pendientes[0].id, 1, 10).generativo, ['Evolucion']);
});

test('llamar_api: datos de RENAPER marcados como generados no cuentan como IA', async () => {
	pendientes.resetStore();
	const ctx = ctxBase({ permisos: ['CONFIGURACION.PERSONAL.CREAR'] });
	await ejecutar(
		'llamar_api',
		{
			metodo: 'POST',
			path: '/api/personal',
			body: { FechaNacimiento: '1996-10-09', ApellidoNombre: 'De Biasi, Emiliano' },
			camposGenerados: ['FechaNacimiento', 'ApellidoNombre'],
		},
		ctx,
	);
	assert.equal(ctx.pendientes.length, 1);
	assert.equal(ctx.pendientes[0].generativo, false);
});

test('manifiesto lee requirePropietario de cada ruta', () => {
	const del = manifiesto.resolver('DELETE', '/api/indicaciones/88');
	assert.equal(del.propietario.tabla, 'imInterIndMedicas');
	assert.equal(del.propietario.pkParam, 'nroIndicacion');
	assert.deepEqual(manifiesto.paramsDe(del, '/api/indicaciones/88'), { nroIndicacion: '88' });

	const dieta = manifiesto.resolver('PUT', '/api/dieta-control/5');
	assert.equal(dieta.propietario.tabla, 'imInterCtrlDieta');
	assert.equal(manifiesto.resolver('POST', '/api/dieta-control').propietario, null);
	assert.ok(manifiesto.describir(del).soloAutor);
});

test('autoria.anotar marca registros propios por CodOperador / matrícula', () => {
	const req = { valorPersonal: 10, matricula: 4521, auth: { usuario: { codOperador: 77 } } };
	const body = {
		data: [{ Valor: 1, OperadorCarga: 77 }, { Valor: 2, OperadorCarga: 5 }, { Valor: 3, Profecional: 4521 }, { Valor: 4, Nombre: 'x' }],
	};
	autoria.anotar(body, req);
	assert.deepEqual(
		body.data.map((x) => x._propio),
		[true, false, true, undefined],
	);
	const r = recortar.deApi({ status: 200, body }, ['Valor']);
	assert.equal(r.propios, 2);
	assert.equal(r.items[0]._propio, true);
});

test('llamar_api no ofrece borrar un registro ajeno', async () => {
	pendientes.resetStore();
	const original = autoria.verificar;
	autoria.verificar = async () => ({
		ok: false,
		status: 403,
		mensaje: 'Por restricciones legales, no puede modificar registros creados por otro profesional.',
		codigoError: 'REGISTRO_AJENO',
	});
	try {
		const ctx = ctxBase({ permisos: ['INTERNACION.INDICACIONES.ELIMINAR'] });
		const out = await ejecutar('llamar_api', { metodo: 'DELETE', path: '/api/indicaciones/88' }, ctx);
		assert.equal(out.codigoError, 'REGISTRO_AJENO');
		assert.equal(out.noOfrecer, true);
		assert.equal(ctx.pendientes.length, 0);
	} finally {
		autoria.verificar = original;
	}
});

test('el prompt fija la sección de cada carga y la regla de autoría', () => {
	const p = construirSystemPrompt({
		rol: 'MEDICO',
		identidad: { nombre: 'García, Ana', matricula: 4521 },
		esAdmin: false,
		agente: 'SOPORTE',
		instrucciones: require('../src/asistente/agentes/soporte').instrucciones(),
	});
	assert.match(p, /matrícula 4521/);
	assert.match(p, /español rioplatense/);
	assert.match(p, /SOPORTE/);
	assert.equal(clinica.seccionDeApi('/api/dieta-control'), 'dieta');
});

test('egreso: el motivo se resuelve por texto o código, sin inventar un alta de ficha', () => {
	const lista = [
		{ Valor: 1, Descripcion: 'ALTA MEDICA' },
		{ Valor: 2, Descripcion: 'DERIVACION' },
		{ Valor: 3, Descripcion: 'OBITO' },
	];
	assert.equal(clinica.resolverDisposicion(lista, 'alta medica').Valor, 1);
	assert.equal(clinica.resolverDisposicion([{ Valor: 1, Descripcion: 'ALTA  MEDICA' }], 'alta medica').Valor, 1);
	assert.equal(clinica.resolverDisposicion([{ Valor: 1, Descripcion: 'ALTA  MEDICA' }], 'ALTA MEDICA').Valor, 1);
	assert.equal(clinica.resolverDisposicion(lista, 'alta').Valor, 1);
	assert.equal(clinica.resolverDisposicion(lista, '2').Valor, 2);
	assert.equal(clinica.resolverDisposicion(lista, ''), null);
	assert.equal(clinica.resolverDisposicion(lista, 'xyz').ambiguo, true);
	assert.equal(clinica.resolverDisposicion(lista, 'si').ambiguo, true);
	assert.equal(clinica.resolverDisposicion(lista, 'SI CONFIRMO').ambiguo, true);
	assert.match(clinica.resolverDisposicion(lista, 'si').aviso, /no es un motivo/i);
	const tools = catalogo.seleccionar({
		permisos: ['INTERNACION.MOVIMIENTOS.GESTIONAR'],
		agente: 'SOPORTE',
		tienePermiso: permisosService.tienePermiso,
		puedeSql: false,
	});
	assert.ok(tools.some((h) => h.name === 'buscar_en_manual'));
	assert.ok(!tools.some((h) => h.name === 'llamar_api'));
	assert.ok(!tools.some((h) => h.name === 'egresar_paciente'));
});

test('pedidoEgreso reconoce el alta de un internado y no el alta de personal', () => {
	assert.deepEqual(clinica.pedidoEgreso('necesito que des de alta a gomez francisco'), {
		termino: 'gomez francisco',
	});
	assert.deepEqual(clinica.pedidoEgreso('egresar a Pérez Juan'), { termino: 'perez juan' });
	assert.equal(clinica.pedidoEgreso('dar de alta un médico clínico'), null);
	assert.equal(clinica.pedidoEgreso('alta de personal con DNI 123'), null);
	assert.equal(clinica.pedidoEgreso('cuántos internados hay'), null);
});

test('la primera respuesta de egreso la arma el código, no el modelo', () => {
	const t = clinica.textoDesdeEgreso(
		{
			pedir: 'cual',
			internaciones: [
				{ paciente: 'GOMEZ FRANCISCO', documento: '16296312', numeroVisita: 479635, sector: 'QUR3', cama: '01', ingreso: '08/10/2026' },
				{ paciente: 'GOMEZ FRANCISCO ALFREDO', documento: '16436298', numeroVisita: 478391, sector: 'ONC1', cama: '1C', ingreso: '05/10/2026' },
			],
		},
		'gomez francisco',
	);
	assert.match(t, /479635/);
	assert.match(t, /478391/);
	assert.match(t, /motivo/);
	assert.ok(!/no puedo/i.test(t));
	const uno = clinica.textoDesdeEgreso(
		{
			internaciones: [
				{ paciente: 'GOMEZ FRANCISCO ALFREDO', documento: '16436298', numeroVisita: 478391, sector: 'ONC1', cama: '1C' },
			],
		},
		'gomez francisco',
	);
	assert.match(uno, /478391/);
	assert.match(uno, /motivo/);
	assert.ok(!/visita undefined/.test(uno));
});

test('alta de personal: campos desde el service, sin credenciales; roles solo lectura', () => {
	const d = manifiesto.describir(manifiesto.resolver('POST', '/api/personal'), true);
	for (const c of ['NumeroDocumento', 'ValorEspecialidad', 'MatriculaProvincial', 'IdRol']) assert.ok(d.campos.body.includes(c), c);
	assert.ok(!d.campos.body.some((c) => /password|nombrered|crearusuario/i.test(c)));
	assert.ok(manifiesto.resolver('GET', '/api/roles'));
	assert.equal(manifiesto.resolver('POST', '/api/roles'), null);
	assert.equal(manifiesto.resolver('PUT', '/api/roles/3'), null);
});

test('llamar_api rechaza credenciales en el body', async () => {
	pendientes.resetStore();
	const ctx = ctxBase({ permisos: ['CONFIGURACION.PERSONAL.CREAR'] });
	const out = await ejecutar(
		'llamar_api',
		{ metodo: 'POST', path: '/api/personal', body: { ApellidoNombre: 'X', CrearUsuario: true, Password: '1234' } },
		ctx,
	);
	assert.match(out.error, /credenciales/);
	assert.equal(ctx.pendientes.length, 0);
	const ok = await ejecutar('llamar_api', { metodo: 'POST', path: '/api/personal', body: { ApellidoNombre: 'X', IdRol: 2 } }, ctx);
	assert.equal(ok.requiereConfirmacion, true);
});

test('resumen de permisos agrupa por submódulo y no corta módulos', () => {
	const r = contexto.resumenPermisos(require('../src/utils/permisos').permisosDeRol('ADMIN'));
	assert.match(r, /^CONFIGURACION: .*PERSONAL (todas|VER\/CREAR)/m);
	assert.match(r, /^INTERNACION: .*EVOLUCIONES /m);
	assert.equal(r.split('\n').filter((l) => l.startsWith('INTERNACION:')).length, 1);
});

test('llamar_api: escritura queda pendiente y respeta permisos', async () => {
	pendientes.resetStore();
	const ctx = ctxBase();
	const out = await ejecutar(
		'llamar_api',
		{ metodo: 'POST', path: '/api/evoluciones', body: { IdVisita: 1, Evolucion: 'x' } },
		ctx,
	);
	assert.equal(out.requiereConfirmacion ?? true, true);
	assert.equal(ctx.pendientes.length, 1);
	assert.match(ctx.pendientes[0].detalle, /Evolucion/);

	const sinPermiso = await ejecutar(
		'llamar_api',
		{ metodo: 'POST', path: '/api/evoluciones', body: {} },
		ctxBase({ permisos: ['INTERNACION.EVOLUCIONES.VER'] }),
	);
	assert.match(sinPermiso.error, /Sin permiso/);

	const excluido = await ejecutar('llamar_api', { metodo: 'GET', path: '/api/super-admin/empresas' }, ctxBase());
	assert.match(excluido.error, /No existe/);
});

test('el historial del modelo conserva tool_calls entre turnos', () => {
	const sesion = require('../src/asistente/sesion');
	sesion.resetStore();
	const conv = sesion.crear({ idEmpresa: 1, valorPersonal: 10 });
	sesion.agregarMensaje(conv, 'user', 'dar de alta a Gómez');
	assert.equal(sesion.historialParaModelo(conv).every((m) => m.role === 'user' || m.role === 'assistant'), true);
	sesion.guardarOpenai(conv, [
		{ role: 'system', content: 'x' },
		{ role: 'user', content: 'dar de alta a Gómez' },
		{
			role: 'assistant',
			content: null,
			tool_calls: [{ id: 'c1', type: 'function', function: { name: 'buscar_internacion', arguments: '{}' } }],
		},
		{ role: 'tool', tool_call_id: 'c1', content: '{"internaciones":[{"numeroVisita":478391}]}' },
		{ role: 'assistant', content: 'Encontré a Gómez. ¿Cuál es el motivo?' },
	]);
	const h = sesion.historialParaModelo(conv);
	assert.ok(h.some((m) => m.tool_calls));
	assert.ok(h.some((m) => m.role === 'tool' && /478391/.test(m.content)));
	assert.ok(!h.some((m) => m.role === 'system'));
});

test('un sí con pendiente no se pierde: hay acciones activas del usuario', () => {
	pendientes.resetStore();
	const item = pendientes.crear({
		idEmpresa: 1,
		valorPersonal: 10,
		herramienta: 'egresar_paciente',
		http: { method: 'POST', path: '/api/patients/visitas/egreso', body: {} },
		resumen: 'Egresar a Gómez',
	});
	const activos = pendientes.activosDe(1, 10);
	assert.equal(activos.length, 1);
	assert.equal(activos[0].id, item.id);
	assert.equal(pendientes.paraUi(activos[0]).resumen, 'Egresar a Gómez');
	assert.equal(pendientes.activosDe(1, 99).length, 0);
});

test('lectura de código: sandbox y handler de egreso', async () => {
	const codigo = require('../src/asistente/codigo');
	assert.equal(codigo.resolverRel('../../.env'), null);
	assert.equal(codigo.resolverRel('config/jwt.js'), null);
	assert.equal(codigo.resolverRel('controllers/auth.controller.js'), null);
	assert.ok(codigo.resolverRel('services/visitaMovimientos.service.js'));
	const blocked = codigo.leer({ archivo: 'controllers/auth.controller.js' });
	assert.match(blocked.error, /no permitido/i);
	const hits = codigo.buscar({ texto: 'actualizarUltimoMovimientoVisita', carpeta: 'services' });
	assert.ok(hits.hits.some((h) => /visitaMovimientos/.test(h.archivo)));
	const fn = codigo.leer({
		archivo: 'services/visitaMovimientos.service.js',
		handler: 'actualizarUltimoMovimientoVisita',
	});
	assert.match(fn.codigo, /FechaEgreso|egreso/i);
	const ep = codigo.leer({ metodo: 'POST', path: '/api/patients/visitas/egreso' });
	assert.equal(ep.endpoint.metodo, 'POST');
	assert.match(ep.endpoint.path, /egreso/);
	assert.ok(ep.codigo && /numeroVisita|egreso/i.test(ep.codigo));
	const viaEjecutar = await ejecutar('buscar_codigo', { texto: 'egreso' }, ctxBase());
	assert.ok(viaEjecutar.hits.length > 0);
	assert.ok(viaEjecutar.archivosRevisados <= codigo.MAX_ARCHIVOS);
	assert.ok(viaEjecutar.endpoints.some((e) => /egreso/i.test(e.path)));
	const amplia = codigo.buscar({ texto: 'paciente' });
	assert.ok(amplia.archivosRevisados <= codigo.MAX_ARCHIVOS);
});

test('buscar internación extrae DNI de la frase y matchea la pantalla', () => {
	const claves = clinica.extraerClavesBusqueda('gomez francisco alfredo numero de dni 16436298');
	assert.equal(claves.dni, '16436298');
	assert.ok(claves.tokens.includes('gomez'));
	assert.ok(claves.tokens.includes('francisco'));
	const internado = {
		numeroVisita: 478391,
		paciente: 'GOMEZ FRANCISCO ALFREDO',
		documento: '16436298',
	};
	assert.equal(clinica.coincideInternado(internado, claves), true);
	assert.equal(
		clinica.coincideInternado(
			{ numeroVisita: 1, paciente: 'LOPEZ FRANCISCO ARIEL', documento: '1' },
			claves,
		),
		false,
	);
	const vis = clinica.extraerClavesBusqueda('478391');
	assert.equal(vis.numeroVisita, 478391);
	const p = contexto.pantallaDeBody({
		url: '/dashboard/beds/1C',
		internadosVisibles: [{ numeroVisita: 478391, paciente: 'GOMEZ FRANCISCO ALFREDO', documento: '16436298', sector: 'ONC1', cama: '1C' }],
	});
	assert.equal(p.internado.numeroVisita, 478391);
	assert.equal(clinica.internadosDeContexto({ pantalla: p }).length, 1);
});

test('anotarAccion: el modelo ve el estado de la tarjeta como system, nunca como mensaje propio', () => {
	const sesion = require('../src/asistente/sesion');
	const nota = '[Cancelado por el usuario, NO se ejecutó] Egresar a X';
	const conv = { mensajes: [], openai: [{ role: 'user', content: 'egresar' }, { role: 'assistant', content: 'Tarjeta lista' }] };
	assert.equal(sesion.notaAcciones(conv), null);
	sesion.anotarAccion(conv, nota);
	assert.equal(conv.mensajes.at(-1).content, nota);
	assert.ok(!sesion.historialParaModelo(conv).some((m) => m.content === nota));
	const sys = sesion.notaAcciones(conv);
	assert.equal(sys.role, 'system');
	assert.match(sys.content, /Egresar a X/);

	const sinOpenai = { mensajes: [] };
	sesion.agregarMensaje(sinOpenai, 'user', 'egresar');
	sesion.anotarAccion(sinOpenai, nota);
	assert.deepEqual(sesion.historialParaModelo(sinOpenai), [{ role: 'user', content: 'egresar' }]);
	sesion.anotarAccion(null, 'sin conversación no rompe');
});

test('historial: el resultado largo de una tool de un turno anterior se recorta con aviso; la respuesta queda entera', () => {
	const sesion = require('../src/asistente/sesion');
	const conv = { mensajes: [] };
	const largo = JSON.stringify({ estudios: Array.from({ length: 50 }, (_, i) => ({ practica: `ECOGRAFIA ${i}`, resultado: 'x'.repeat(80) })) });
	const respuesta = `Resumen de estudios: ${'y'.repeat(1500)}`;
	sesion.guardarOpenai(conv, [
		{ role: 'user', content: 'estudios hechos' },
		{ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ver_estudios', arguments: '{}' } }] },
		{ role: 'tool', tool_call_id: 'c1', content: largo },
		{ role: 'assistant', content: respuesta },
	]);
	const h = sesion.historialParaModelo(conv);
	const tool = h.find((m) => m.role === 'tool');
	assert.ok(tool.content.length < 900);
	assert.match(tool.content, /turno anterior, recortado/);
	assert.equal(h[h.length - 1].content, respuesta);
});
