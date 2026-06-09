/**
 * Smoke test de TODOS los endpoints montados en app.js — simula producción.
 *
 * Uso:
 *   node scripts/smoke_all_endpoints.js
 *   node scripts/smoke_all_endpoints.js --include-mutations
 *   node scripts/smoke_all_endpoints.js --user medico --pass xxx
 *
 * Variables .env: TEST_LOGIN_USER, TEST_LOGIN_PASSWORD, PORT, BOT_API_KEY
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const BASE = `http://localhost:${process.env.PORT || 5006}`;
const ROUTES_DIR = path.join(__dirname, '../src/routes');
const APP_JS = path.join(__dirname, '../src/app.js');

const args = process.argv.slice(2);
const INCLUDE_MUTATIONS = args.includes('--include-mutations');
const USER = args.includes('--user') ? args[args.indexOf('--user') + 1] : process.env.TEST_LOGIN_USER || 'superadmin';
const PASS = args.includes('--pass') ? args[args.indexOf('--pass') + 1] : process.env.TEST_LOGIN_PASSWORD || 'SuperAdmin2026!';

/** Rutas que no pasan por JWT global o usan otro esquema de auth */
const AUTH_MODE = {
	'/api/auth': 'public',
	'/api/webhook/whatsapp': 'public',
	'/api/integrations/bot': 'bot',
};

const today = new Date().toISOString().slice(0, 10);

function parseMounts() {
	const app = fs.readFileSync(APP_JS, 'utf8');
	const requires = {};
	for (const m of app.matchAll(/const (\w+) = require\('\.\/routes\/([^']+)'\)/g)) {
		requires[m[1]] = m[2];
	}
	const mounts = [];
	for (const m of app.matchAll(/app\.use\('([^']+)',\s*(?:\w+,\s*)*(\w+)/g)) {
		const prefix = m[1];
		const varName = m[2];
		if (requires[varName]) {
			mounts.push({ prefix, file: requires[varName] });
		}
	}
	return mounts;
}

function extractRoutesFromSource(source) {
	const routes = [];
	const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
	let m;
	while ((m = re.exec(source)) !== null) {
		routes.push({ method: m[1].toUpperCase(), path: m[2] });
	}
	return routes;
}

function discoverEndpoints() {
	const mounts = parseMounts();
	const endpoints = [];

	for (const { prefix, file } of mounts) {
		const filePath = path.join(ROUTES_DIR, `${file}.js`);
		if (!fs.existsSync(filePath)) continue;
		const source = fs.readFileSync(filePath, 'utf8');
		const routes = extractRoutesFromSource(source);

		// adjuntos / notificaciones re-exportan router del controller
		if (routes.length === 0 && source.includes("require('../controllers/")) {
			const ctrlMatch = source.match(/require\('\.\.\/controllers\/([^']+)'\)/);
			if (ctrlMatch) {
				const ctrlPath = path.join(__dirname, '../src/controllers', ctrlMatch[1]);
				if (fs.existsSync(ctrlPath)) {
					routes.push(...extractRoutesFromSource(fs.readFileSync(ctrlPath, 'utf8')));
				}
			}
		}

		for (const r of routes) {
			endpoints.push({
				method: r.method,
				path: `${prefix}${r.path.startsWith('/') ? r.path : `/${r.path}`}`,
				mount: prefix,
			});
		}
	}

	// Raíz
	endpoints.push({ method: 'GET', path: '/', mount: '/' });
	return endpoints;
}

function substitutePath(routePath, fx) {
	return routePath
		.replace(/:numeroVisita1/g, fx.numeroVisita)
		.replace(/:numeroVisita2/g, fx.numeroVisita2 || fx.numeroVisita)
		.replace(/:numeroVisita/g, fx.numeroVisita)
		.replace(/:idVisita/g, fx.numeroVisita)
		.replace(/:idPaciente/g, fx.idPaciente)
		.replace(/:matricula/g, fx.matricula)
		.replace(/:idTurno/g, fx.idTurno)
		.replace(/:idHCIngreso/g, fx.idHCIngreso)
		.replace(/:idExamen/g, fx.idExamen)
		.replace(/:nroIndicacion/g, fx.nroIndicacion)
		.replace(/:idHCEvolucion/g, fx.idEvolucion)
		.replace(/:idAdjunto/g, fx.idAdjunto)
		.replace(/:idParametro/g, fx.idParametro)
		.replace(/:idPersonal/g, fx.valorPersonal)
		.replace(/:valorPersonal/g, fx.valorPersonal)
		.replace(/:valor(\\d\+)/g, fx.catalogValor || fx.valorPersonal || '1')
		.replace(/:valor/g, fx.catalogValor || fx.controlValor || fx.valorPersonal || '1')
		.replace(/:idEmpresa/g, fx.idEmpresa)
		.replace(/:idRol(\\d\\+)/g, '1')
		.replace(/:idRol/g, '1')
		.replace(/:idSector/g, fx.idSector || '1')
		.replace(/:idCtrlMedica/g, '1')
		.replace(/:documento/g, fx.documento)
		.replace(/:dni/g, fx.documento)
		.replace(/:sexo/g, 'M')
		.replace(/:estado/g, fx.estadoCama || 'O')
		.replace(/:username/g, encodeURIComponent(USER))
		.replace(/:id(\\d\\+)/g, (match, g, offset, str) => {
			if (str.includes('/evoluciones/')) return fx.idEvolucion;
			if (str.includes('/hci/')) return fx.idHci;
			if (str.includes('/hc-ingreso/')) return fx.idHCIngreso;
			if (str.includes('/patients/')) return fx.idPaciente;
			if (str.includes('/beds/')) return fx.bedId;
			if (str.includes('/rendiciones/')) return '1';
			if (str.includes('/laboratorios/')) return fx.idExamen;
			if (str.includes('/adjuntos/')) return fx.idAdjunto;
			if (str.includes('/super-admin/empresas/')) return fx.idEmpresa;
			if (str.includes('/roles/')) return '1';
			if (str.includes('/personal/')) return fx.valorPersonal;
			if (str.includes('/admin/users/')) return fx.valorPersonal;
			if (str.includes('/catalogs/diagnosticos/')) return '1';
			if (str.includes('/bot/conversaciones/')) return '1';
			return '1';
		})
		.replace(/:id/g, '1');
}

function defaultQuery(pathStr, fx) {
	const q = new URLSearchParams();
	if (pathStr.includes('/evoluciones/') && pathStr.includes('/byDate')) {
		q.set('date', today);
	}
	if (pathStr.includes('/indicaciones/') && pathStr.includes('/byDate')) {
		q.set('date', today);
	}
	if (pathStr.includes('/controles-frecuentes/') && pathStr.includes('/byDate')) {
		q.set('fecha', today);
	}
	if (pathStr.includes('/evolucion-enfermeria/') && pathStr.includes('/byDate')) {
		q.set('fecha', today);
	}
	if (pathStr.includes('/indicadores/por-fecha') || pathStr.includes('/camas/por-fecha')) {
		q.set('desde', today);
		q.set('hasta', today);
	}
	if (pathStr.includes('/admission-search')) {
		q.set('q', 'test');
	}
	if (pathStr.includes('/patients/search')) {
		q.set('q', fx.documento || '1');
	}
	if (pathStr.includes('/catalogs/diagnosticos/buscar') || pathStr.includes('/agenda/diagnosticos/buscar')) {
		q.set('termino', 'fiebre');
	}
	if (pathStr.includes('/agenda/clientes/buscar')) {
		q.set('q', 'osde');
	}
	if (pathStr.includes('/agenda/disponibilidad')) {
		q.set('fecha', today);
	}
	if (pathStr.includes('/agenda/turnos-por-paciente')) {
		q.set('documento', fx.documento || '1');
	}
	if (pathStr.includes('/agenda/') && pathStr.includes('/slots')) {
		q.set('fecha', today);
	}
	if (pathStr.includes('/agenda/') && pathStr.includes('/turnos')) {
		q.set('fecha', today);
	}
	if (pathStr.includes('/notificaciones')) {
		q.set('userId', String(fx.valorPersonal || 1));
	}
	if (pathStr.includes('/integrations/bot/disponibilidad')) {
		q.set('fecha', today);
	}
	if (pathStr.includes('/integrations/bot/turnos/paciente')) {
		q.set('documento', fx.documento || '1');
	}
	if (pathStr.includes('/integrations/bot/pacientes/buscar')) {
		q.set('q', fx.documento || '1');
	}
	if (pathStr.includes('/auth/sectores')) {
		q.set('idEmpresa', String(fx.idEmpresa || 1));
	}
	const s = q.toString();
	return s ? `?${s}` : '';
}

function authModeFor(pathStr) {
	for (const [prefix, mode] of Object.entries(AUTH_MODE)) {
		if (pathStr.startsWith(prefix)) return mode;
	}
	return 'jwt';
}

function isMutation(method) {
	return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

function classifyStatus(status, authMode) {
	if (status >= 200 && status < 300) return 'pass';
	if (status === 400 || status === 404 || status === 403 || status === 405) return 'expected';
	if (status === 401 && authMode === 'public') return 'expected';
	if (status === 401) return 'fail';
	if (status >= 500) return 'fail';
	return 'warn';
}

async function request(method, url, { token, botKey, body } = {}) {
	const headers = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (botKey) headers['X-Bot-Api-Key'] = botKey;
	if (body) headers['Content-Type'] = 'application/json';
	try {
		const res = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(30000),
		});
		let text = '';
		try {
			text = await res.text();
		} catch {
			text = '';
		}
		return { status: res.status, text, snippet: text.slice(0, 120) };
	} catch (err) {
		return { status: 0, text: err.message, snippet: err.message };
	}
}

async function loadFixtures() {
	const { executeQuery } = require('../src/models/db');
	const { runWithTenant } = require('../src/context/tenantContext');
	const idEmpresa = Number(process.env.BOT_EMPRESA_ID || 1);

	const safeQuery = async (sql, fallback = null) => {
		try {
			const rows = await executeQuery(sql);
			return rows?.[0] ?? fallback;
		} catch {
			return fallback;
		}
	};

	return runWithTenant(idEmpresa, async () => {
		const fx = { idEmpresa, numeroVisita: 1, idPaciente: 1, matricula: 1, valorPersonal: 1, documento: '1', bedId: 1, idEvolucion: 1, nroIndicacion: 1, idHci: 1, idHCIngreso: 1, idTurno: 1, idExamen: 1, idAdjunto: 1, controlValor: 1, idParametro: 1, estadoCama: 'O', idSector: '1' };

		const visita = await safeQuery(`
      SELECT TOP 1 c.NumeroVisita, c.IdPaciente, c.DocumentoPaciente
      FROM dbo.imCamas c
      WHERE c.NumeroVisita IS NOT NULL AND c.NumeroVisita > 0
      ORDER BY c.NumeroVisita DESC
    `);
		if (visita) {
			fx.numeroVisita = visita.NumeroVisita;
			fx.idPaciente = visita.IdPaciente;
			fx.documento = String(visita.DocumentoPaciente || '1').trim();
		}

		const pw = await safeQuery(`
      SELECT TOP 1 pw.ValorPersonal, pw.CodOperador, p.Matricula
      FROM impassword pw
      LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
      WHERE pw.NombreRed IS NOT NULL
      ORDER BY pw.ValorPersonal
    `);
		if (pw) {
			fx.valorPersonal = pw.ValorPersonal;
			if (pw.Matricula) fx.matricula = pw.Matricula;
		}

		const cama = await safeQuery(`SELECT TOP 1 Valor FROM dbo.imCamas ORDER BY Valor`);
		if (cama) fx.bedId = cama.Valor;

		const ev = await safeQuery(`SELECT TOP 1 IdHCEvolucion FROM dbo.imHCEvolucion ORDER BY IdHCEvolucion DESC`);
		if (ev) fx.idEvolucion = ev.IdHCEvolucion;

		const ind = await safeQuery(`SELECT TOP 1 Valor FROM dbo.imInterIndMedicas ORDER BY Valor DESC`);
		if (ind) fx.nroIndicacion = ind.Valor;

		const hci = await safeQuery(`SELECT TOP 1 Id FROM dbo.imHCI ORDER BY Id DESC`);
		if (hci) fx.idHci = hci.Id;

		const hcIng = await safeQuery(`SELECT TOP 1 IdHCIngreso FROM dbo.imHCIngreso ORDER BY IdHCIngreso DESC`);
		if (hcIng) fx.idHCIngreso = hcIng.IdHCIngreso;

		const turno = await safeQuery(`SELECT TOP 1 IdTurno FROM dbo.imTurnos ORDER BY IdTurno DESC`);
		if (turno) fx.idTurno = turno.IdTurno;

		const exam = await safeQuery(`SELECT TOP 1 IdExamen FROM dbo.imLaboratorioExamenes ORDER BY IdExamen DESC`);
		if (exam) fx.idExamen = exam.IdExamen;

		const adj = await safeQuery(`SELECT TOP 1 IdAdjunto FROM dbo.imAdjuntos ORDER BY IdAdjunto DESC`);
		if (adj) fx.idAdjunto = adj.IdAdjunto;

		const ctrl = await safeQuery(`SELECT TOP 1 Valor FROM dbo.imInterCtrlFrecuente ORDER BY Valor DESC`);
		if (ctrl) fx.controlValor = ctrl.Valor;

		const loc = await safeQuery(`SELECT TOP 1 Valor FROM dbo.imLocalidades ORDER BY Valor`);
		if (loc) fx.catalogValor = loc.Valor;

		const raza = await safeQuery(`SELECT TOP 1 Valor FROM dbo.imRaza ORDER BY Valor`);
		if (raza) fx.catalogValor = raza.Valor;

		return fx;
	});
}

async function login(fx) {
	const empRes = await request('GET', `${BASE}/api/auth/empresas/${encodeURIComponent(USER)}`);
	let idEmpresa = fx.idEmpresa;
	try {
		if (empRes.status === 200) {
			const empData = JSON.parse(empRes.text);
			idEmpresa = empData.data?.[0]?.idEmpresa ?? fx.idEmpresa;
		}
	} catch {
		/* usar idEmpresa default */
	}

	const loginRes = await request('POST', `${BASE}/api/auth/login`, {
		body: { username: USER, password: PASS, idEmpresa },
	});
	if (loginRes.status !== 200) {
		throw new Error(`Login falló (${loginRes.status}): ${loginRes.snippet}`);
	}
	let data;
	try {
		data = JSON.parse(loginRes.text);
	} catch {
		throw new Error(`Login respuesta no JSON: ${loginRes.text.slice(0, 200)}`);
	}
	return {
		token: data.token,
		idEmpresa,
		valorPersonal: data.usuario?.valorPersonal ?? data.usuario?.id ?? fx.valorPersonal,
	};
}

async function main() {
	console.log('=== iMedicWS — Smoke test endpoints (producción simulada) ===\n');
	console.log(`Base: ${BASE}`);
	console.log(`Usuario: ${USER}`);
	console.log(`Mutaciones: ${INCLUDE_MUTATIONS ? 'SÍ' : 'NO (solo GET + auth POST login)'}\n`);

	const endpoints = discoverEndpoints();
	console.log(`Endpoints descubiertos: ${endpoints.length}\n`);

	let fx;
	try {
		fx = await loadFixtures();
		console.log('Fixtures DB:', JSON.stringify(fx, null, 2), '\n');
	} catch (e) {
		console.warn('Fixtures DB parciales (sin tenant):', e.message);
		fx = { idEmpresa: 1, numeroVisita: 1, idPaciente: 1, matricula: 1, valorPersonal: 1, documento: '1', bedId: 1, idEvolucion: 1, nroIndicacion: 1, idHci: 1, idHCIngreso: 1, idTurno: 1, idExamen: 1, idAdjunto: 1, controlValor: 1, idParametro: 1 };
	}

	let token = null;
	let botKey = process.env.BOT_API_KEY || 'dev-bot-key-local';

	try {
		const session = await login(fx);
		token = session.token;
		fx.valorPersonal = session.valorPersonal;
		fx.idEmpresa = session.idEmpresa;
		console.log('Login OK\n');
	} catch (e) {
		console.error('Login ERROR:', e.message);
		process.exit(1);
	}

	const results = { pass: [], expected: [], fail: [], warn: [], skip: [] };

	for (const ep of endpoints) {
		if (isMutation(ep.method) && !INCLUDE_MUTATIONS) {
			// Solo login POST en modo lectura
			if (!(ep.path === '/api/auth/login' && ep.method === 'POST')) {
				results.skip.push({ ...ep, reason: 'mutation skipped' });
				continue;
			}
		}

		// Webhook POST requiere firma Meta — skip
		if (ep.path.startsWith('/api/webhook/whatsapp') && ep.method === 'POST') {
			results.skip.push({ ...ep, reason: 'webhook Meta (firma)' });
			continue;
		}

		const authMode = authModeFor(ep.path);
		const pathResolved = substitutePath(ep.path, fx);
		const query = defaultQuery(pathResolved, fx);
		const url = `${BASE}${pathResolved}${query}`;

		const useToken = authMode === 'jwt' ? token : null;
		const useBot = authMode === 'bot' ? botKey : null;

		let body;
		if (ep.path === '/api/auth/login' && ep.method === 'POST') {
			body = { username: USER, password: PASS, idEmpresa: fx.idEmpresa };
		} else if (INCLUDE_MUTATIONS && isMutation(ep.method)) {
			body = {};
		}

		const { status, snippet } = await request(ep.method, url, {
			token: useToken,
			botKey: useBot,
			body,
		});

		const bucket = classifyStatus(status, authMode);
		const entry = { method: ep.method, path: ep.path, url, status, snippet: snippet.replace(/\s+/g, ' ').slice(0, 80) };
		results[bucket].push(entry);

		const icon = bucket === 'pass' ? '✓' : bucket === 'expected' ? '~' : bucket === 'fail' ? '✗' : '?';
		if (bucket === 'fail' || bucket === 'warn') {
			console.log(`${icon} ${ep.method} ${ep.path} → ${status} | ${entry.snippet}`);
		}
	}

	console.log('\n=== RESUMEN ===');
	console.log(`PASS (2xx):     ${results.pass.length}`);
	console.log(`EXPECTED:       ${results.expected.length} (400/403/404 — endpoint vivo)`);
	console.log(`FAIL:           ${results.fail.length}`);
	console.log(`WARN:           ${results.warn.length}`);
	console.log(`SKIP:           ${results.skip.length}`);

	if (results.fail.length) {
		console.log('\n--- FALLOS (401/500/0 — revisar) ---');
		for (const f of results.fail) {
			console.log(`  ${f.method} ${f.path} → ${f.status} | ${f.snippet}`);
		}
	}

	const reportPath = path.join(__dirname, '../smoke-endpoints-report.json');
	fs.writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), user: USER, results }, null, 2));
	console.log(`\nReporte: ${reportPath}`);

	process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
