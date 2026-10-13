/**
 * Corre escenarios CRUD contra el asistente, como el chat.
 * No confirma escrituras (no toca la base clínica).
 *
 *   node scripts/asistente_escenarios.js
 */
require('dotenv').config();

const BASE = `http://127.0.0.1:${process.env.PORT || 5006}`;
const USER = process.env.TEST_LOGIN_USER || 'adminvidal';
const PASS = process.env.TEST_LOGIN_PASSWORD || 'admin@vidal';
const ID_EMPRESA = Number(process.env.TEST_LOGIN_EMPRESA || 1);

const ESCENARIOS = [
	{
		id: 'read-conteo',
		ruta: '/dashboard/beds',
		turnos: ['cuántos internados hay ahora'],
	},
	{
		id: 'read-paciente',
		ruta: '/dashboard/beds',
		turnos: ['dónde está internado gomez francisco'],
	},
	{
		id: 'read-manual',
		ruta: '/dashboard',
		turnos: ['cómo hago un ingreso de un paciente'],
	},
	{
		id: 'create-ingreso',
		ruta: '/dashboard/admission/new',
		turnos: ['quiero internar a un paciente que ya está cargado'],
	},
	{
		id: 'update-egreso',
		ruta: '/dashboard/beds',
		pantalla: {
			url: '/dashboard/beds',
			titulo: 'Mapa de camas',
			internadosVisibles: [
				{
					paciente: 'GOMEZ FRANCISCO ALFREDO',
					documento: '16436298',
					numeroVisita: 478391,
					cama: '1C',
					sector: 'ONC1',
				},
			],
		},
		turnos: ['necesito que des de alta a gomez francisco'],
	},
	{
		id: 'create-evolucion',
		ruta: '/dashboard/visita/478391',
		turnos: ['cargá una evolución médica: paciente estable, sin cambios'],
	},
	{
		id: 'update-cama',
		ruta: '/dashboard/beds',
		turnos: ['pasá la cama 12 a estado de limpieza'],
	},
	{
		id: 'delete-evolucion',
		ruta: '/dashboard/visita/478391',
		turnos: ['borrá la última evolución que cargué yo'],
	},
	{
		id: 'alta-personal',
		ruta: '/dashboard/personal',
		turnos: ['dar de alta un médico clínico nuevo'],
	},
	{
		id: 'navegar',
		ruta: '/dashboard',
		turnos: ['llevame al mapa de camas'],
	},
];

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

function recortarTexto(t, n = 500) {
	const s = String(t || '').replace(/\s+/g, ' ').trim();
	return s.length <= n ? s : `${s.slice(0, n)}…`;
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
	return {
		token: loginRes.data.token,
		idEmpresa,
		rol: loginRes.data.usuario?.rolNombre || loginRes.data.rolNombre || loginRes.data.usuario?.RolNombre,
	};
}

async function main() {
	const health = await fetch(`${BASE}/api/health`).catch(() => null);
	if (!health || !health.ok) {
		const alt = await fetch(`${BASE}/`).catch((e) => e);
		if (!health) throw new Error(`Backend no responde en ${BASE}`);
	}

	const auth = await login();
	const caps = await request('GET', '/api/asistente/capacidades', { token: auth.token });
	console.log(
		JSON.stringify(
			{
				base: BASE,
				usuario: USER,
				rol: auth.rol,
				modelo: caps.data?.modelo,
				sql: caps.data?.sql,
				tools: caps.data?.herramientas,
				endpoints: caps.data?.endpoints,
			},
			null,
			2,
		),
	);

	const corridas = [];
	for (const esc of ESCENARIOS) {
		const ses = await request('POST', '/api/asistente/sesion', {
			token: auth.token,
			body: { rutaActual: esc.ruta },
		});
		let idConversacion = ses.data?.idConversacion || null;
		const turnosOut = [];
		for (const mensaje of esc.turnos) {
			const t0 = Date.now();
			const r = await request('POST', '/api/asistente/mensaje', {
				token: auth.token,
				body: {
					mensaje,
					rutaActual: esc.ruta,
					idConversacion,
					pantalla: esc.pantalla || { url: esc.ruta },
				},
			});
			idConversacion = r.data?.idConversacion || idConversacion;
			const pendientes = r.data?.pendientes || [];
			for (const p of pendientes) {
				await request('POST', '/api/asistente/cancelar', {
					token: auth.token,
					body: { idPendiente: p.id, idConversacion },
				});
			}
			turnosOut.push({
				mensaje,
				http: r.status,
				ok: Boolean(r.data?.success),
				modo: r.data?.modo,
				ms: Date.now() - t0,
				herramientas: r.data?.herramientas || [],
				pendientes: pendientes.map((p) => ({
					id: p.id,
					resumen: p.resumen,
					metodo: p.metodo,
				})),
				navegaciones: (r.data?.navegaciones || []).map((n) => n.href),
				consultas: (r.data?.consultas || []).length,
				texto: recortarTexto(r.data?.texto || r.data?.mensaje, 420),
				consumo: r.data?.consumo || null,
				error: r.data?.success === false ? r.data?.mensaje : null,
			});
		}
		corridas.push({ id: esc.id, ruta: esc.ruta, turnos: turnosOut });
		console.error(`ok ${esc.id}`);
	}

	const tot = { usd: 0, entrada: 0, cacheadas: 0, salida: 0, llamadas: 0, ms: 0, pedidos: 0 };
	const porTool = {};
	for (const c of corridas) {
		for (const t of c.turnos) {
			tot.pedidos += 1;
			const k = t.consumo;
			if (!k) continue;
			tot.usd += Number(k.costoUsd || 0);
			tot.entrada += Number(k.tokens?.entrada || 0);
			tot.cacheadas += Number(k.tokens?.cacheadas || 0);
			tot.salida += Number(k.tokens?.salida || 0);
			tot.llamadas += Number(k.llamadas || 0);
			tot.ms += Number(k.ms || 0);
			for (const h of k.porHerramienta || []) {
				if (!porTool[h.nombre]) porTool[h.nombre] = { veces: 0, costoUsd: 0, tokens: 0 };
				porTool[h.nombre].veces += h.veces || 0;
				porTool[h.nombre].costoUsd += h.costoUsd || 0;
				porTool[h.nombre].tokens += h.tokensReenviados || 0;
			}
		}
	}

	console.log(
		'\n===RESULTADO===\n' +
			JSON.stringify(
				{
					totales: {
						pedidos: tot.pedidos,
						llamadasModelo: tot.llamadas,
						usd: Number(tot.usd.toFixed(6)),
						promedioUsd: tot.pedidos ? Number((tot.usd / tot.pedidos).toFixed(6)) : 0,
						tokens: {
							entrada: tot.entrada,
							cacheadas: tot.cacheadas,
							salida: tot.salida,
							total: tot.entrada + tot.salida,
						},
						ms: tot.ms,
					},
					porHerramienta: porTool,
					corridas,
				},
				null,
				2,
			),
	);
}

main().catch((err) => {
	console.error('FATAL', err.message || err);
	process.exit(1);
});
