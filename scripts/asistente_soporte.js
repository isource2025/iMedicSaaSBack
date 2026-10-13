/**
 * CRUD + ida/vuelta del módulo SOPORTE.
 *
 *   node scripts/asistente_soporte.js
 *
 * 1) CRUD local (sin OpenAI): crear sesión de tools, leer, actualizar campo, cancelar.
 * 2) Si el backend está arriba: login + chat real con debug (log de traza).
 */
require('dotenv').config();

const { ejecutar } = require('../src/asistente/ejecutar');
const pendientes = require('../src/asistente/pendientes');
const contexto = require('../src/asistente/contexto');
const permisosService = require('../src/services/permisos.service');
const marca = require('../src/asistente/marca');

const BASE = `http://127.0.0.1:${process.env.PORT || 5006}`;
const USER = process.env.TEST_LOGIN_USER || 'adminvidal';
const PASS = process.env.TEST_LOGIN_PASSWORD || 'admin@vidal';
const ID_EMPRESA = Number(process.env.TEST_LOGIN_EMPRESA || 1);

function fail(msg) {
	throw new Error(msg);
}

function ok(cond, msg) {
	if (!cond) fail(msg);
	console.log(`  OK  ${msg}`);
}

function ctxTools() {
	return {
		permisos: ['ADMISION.PACIENTES.VER', 'INTERNACION.CAMAS.VER'],
		tienePermiso: permisosService.tienePermiso,
		idEmpresa: 1,
		valorPersonal: 10,
		token: 't',
		req: {
			headers: {},
			rolNombre: 'ADMIN',
			auth: { usuario: { nombre: 'Ana', apellido: 'García' } },
			matricula: 1,
		},
		navegaciones: [],
		pendientes: [],
		consultas: [],
		inserciones: [],
		traza: [],
		pantalla: contexto.pantallaDeBody({
			url: '/dashboard',
			titulo: 'Inicio',
			campos: [{ id: 'c1', etiqueta: 'Notas', multilinea: true, valor: '' }],
		}),
	};
}

async function crudLocal() {
	console.log('\n=== SOPORTE CRUD local (tools, sin modelo) ===\n');
	pendientes.resetStore();
	const ctx = ctxTools();

	const manual = await ejecutar('buscar_en_manual', { pregunta: 'cómo hago un ingreso de un paciente' }, ctx);
	ok(manual.articulos?.length >= 1, `READ manual: ${manual.articulos.length} artículo(s)`);
	ok(
		manual.articulos.some((a) => /admis/i.test(a.titulo || a.path || '')),
		'READ manual menciona admisión',
	);

	const pant = await ejecutar('listar_pantallas', { filtro: 'camas' }, ctx);
	ok(pant.total >= 1, `READ pantallas filtro camas: ${pant.total}`);
	ok(
		pant.pantallas.some((p) => p.path === '/dashboard/beds'),
		'READ incluye /dashboard/beds',
	);

	const nav = await ejecutar('navegar', { path: '/dashboard/beds', motivo: 'mapa de camas' }, ctx);
	ok(nav.ok === true && nav.href === '/dashboard/beds', `CREATE nav: ${nav.href}`);
	ok(ctx.navegaciones.length === 1, 'CREATE nav quedó en ctx');

	const bloqueada = await ejecutar('navegar', { path: '/dashboard/super-admin/empresas' }, ctx);
	ok(/no permitida/i.test(bloqueada.error || ''), 'CREATE nav bloquea super-admin');

	const campo = await ejecutar(
		'escribir_en_campo',
		{ campoId: 'c1', texto: 'Recordatorio de admisión.', motivo: 'prueba CRUD' },
		ctx,
	);
	ok(campo.requiereConfirmacion && campo.idInsercion, `UPDATE campo pendiente ${campo.idInsercion}`);
	ok(ctx.inserciones.length === 1, 'UPDATE no escribió todavía');
	ok(ctx.pendientes.length === 0, 'UPDATE no es pendiente HTTP');

	const peek = pendientes.peek(campo.idInsercion, 1, 10);
	ok(peek?.tipo === 'insercion', 'UPDATE peek inserción');

	const cancel = pendientes.cancelar(campo.idInsercion, 1, 10);
	ok(cancel === true, 'DELETE cancelar inserción');
	ok(pendientes.peek(campo.idInsercion, 1, 10) == null, 'DELETE ya no está');

	const campo2 = await ejecutar('escribir_en_campo', { campoId: 'c1', texto: 'Texto a aplicar.' }, ctx);
	const item = pendientes.tomar(campo2.idInsercion, 1, 10);
	ok(item?.insercion?.texto === 'Texto a aplicar.', 'UPDATE aplicar consume la inserción');
	const textoMarca = marca.marcar(item.insercion.texto, ctx.req, new Date(2026, 9, 12, 18, 0));
	ok(/IA iMedic/i.test(textoMarca), 'UPDATE aplicar agrega marca IA');

	ok(ctx.traza.length >= 5, `TRAZA local: ${ctx.traza.length} pasos`);
	console.log(
		JSON.stringify(
			{
				pasos: ctx.traza.map((t) => ({
					tool: t.nombre,
					ok: !t.resultado?.error,
					resumen: t.resultado?.error || t.resultado?.href || t.resultado?.aviso || `${t.resultado?.articulos?.length ?? t.resultado?.total ?? ''}`.trim(),
				})),
			},
			null,
			2,
		),
	);
}

async function request(method, path, { token, body } = {}) {
	const resp = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await resp.json().catch(() => ({}));
	return { status: resp.status, data };
}

async function login() {
	const emp = await request('GET', `/api/auth/empresas/${encodeURIComponent(USER)}`);
	const idEmpresa = emp.data?.data?.[0]?.idEmpresa ?? emp.data?.[0]?.idEmpresa ?? ID_EMPRESA;
	const loginRes = await request('POST', '/api/auth/login', {
		body: { username: USER, password: PASS, idEmpresa },
	});
	if (loginRes.status !== 200 || !loginRes.data?.token) {
		throw new Error(`Login falló (${loginRes.status}): ${JSON.stringify(loginRes.data).slice(0, 300)}`);
	}
	return { token: loginRes.data.token, idEmpresa };
}

const CHATS = [
	{
		id: 'read-manual',
		mensaje: 'cómo hago un ingreso de un paciente',
		ruta: '/dashboard',
		esperarTool: 'buscar_en_manual',
	},
	{
		id: 'read-pantallas',
		mensaje: 'qué pantallas tengo de internación',
		ruta: '/dashboard',
		esperarTool: 'listar_pantallas',
	},
	{
		id: 'create-nav',
		mensaje: 'llevame al mapa de camas',
		ruta: '/dashboard',
		esperarTool: 'navegar',
	},
	{
		id: 'update-campo',
		mensaje: 'escribí en el campo de notas: control de admisión pendiente',
		ruta: '/dashboard',
		pantalla: {
			url: '/dashboard',
			titulo: 'Inicio',
			campos: [{ id: 'c1', etiqueta: 'Notas', tipo: 'text', multilinea: true, valor: '' }],
		},
		esperarTool: 'escribir_en_campo',
	},
];

async function crudVivo() {
	const health = await fetch(`${BASE}/api/health`).catch(() => null);
	if (!health || !health.ok) {
		console.log(`\n=== SOPORTE chat vivo: backend no está en ${BASE} (omitido) ===\n`);
		return { omitido: true };
	}

	console.log('\n=== SOPORTE chat vivo (ida/vuelta con modelo) ===\n');
	const auth = await login();
	const caps = await request('GET', '/api/asistente/capacidades', { token: auth.token });
	ok(caps.status === 200, `capacidades HTTP ${caps.status}`);
	ok(caps.data?.agentes?.some((a) => a.id === 'SOPORTE' && a.listo), 'agente SOPORTE listo');
	ok(
		Array.isArray(caps.data?.herramientas) && caps.data.herramientas.includes('buscar_en_manual'),
		`tools chat: ${caps.data?.herramientas}`,
	);
	ok(!caps.data.herramientas.includes('llamar_api'), 'llamar_api no está en Soporte');

	const corridas = [];
	for (const esc of CHATS) {
		const ses = await request('POST', '/api/asistente/sesion', {
			token: auth.token,
			body: { rutaActual: esc.ruta },
		});
		ok(Boolean(ses.data?.idConversacion), `CREATE sesion ${esc.id}`);
		const t0 = Date.now();
		const r = await request('POST', '/api/asistente/mensaje', {
			token: auth.token,
			body: {
				mensaje: esc.mensaje,
				rutaActual: esc.ruta,
				idConversacion: ses.data.idConversacion,
				debug: true,
				pantalla: esc.pantalla || { url: esc.ruta },
			},
		});
		ok(r.status === 200 && r.data?.success, `${esc.id} HTTP ${r.status} success=${r.data?.success}`);
		ok(r.data?.agente === 'SOPORTE', `${esc.id} agente=${r.data?.agente}`);
		const tools = r.data?.herramientas || [];
		ok(tools.includes(esc.esperarTool), `${esc.id} usó ${esc.esperarTool} (fue: ${tools.join(',') || 'ninguna'})`);
		if (esc.id === 'create-nav') {
			ok((r.data.navegaciones || []).some((n) => /\/dashboard\/beds/.test(n.href || n.path || '')), 'CREATE nav hacia camas');
		}
		if (esc.id === 'update-campo') {
			ok((r.data.inserciones || []).length >= 1, 'UPDATE dejó inserción');
			const ins = r.data.inserciones[0];
			const cancel = await request('POST', '/api/asistente/cancelar', {
				token: auth.token,
				body: { idPendiente: ins.id, idConversacion: ses.data.idConversacion },
			});
			ok(cancel.data?.success, 'DELETE cancelar inserción viva');
		}
		const paso = {
			id: esc.id,
			ms: Date.now() - t0,
			agente: r.data.agente,
			tools,
			navegaciones: (r.data.navegaciones || []).map((n) => n.href),
			inserciones: (r.data.inserciones || []).length,
			texto: String(r.data.texto || '').slice(0, 280),
			traza: (r.data.traza || []).map((t) => ({
				tool: t.nombre,
				error: t.resultado?.error || null,
			})),
			consumo: r.data.consumo || null,
		};
		corridas.push(paso);
		console.log(`\n--- ${esc.id} ---\n${JSON.stringify(paso, null, 2)}`);
	}
	return { omitido: false, corridas };
}

async function main() {
	await crudLocal();
	const vivo = await crudVivo();
	console.log('\n=== SOPORTE LISTO ===\n');
	if (vivo.omitido) {
		console.log('CRUD local OK. Levantá el backend y volvé a correr para el ida/vuelta con modelo.');
	} else {
		console.log('CRUD local + chat vivo OK. Módulo Soporte cerrado.');
	}
}

main().catch((err) => {
	console.error('\nFAIL SOPORTE', err.message || err);
	process.exit(1);
});
