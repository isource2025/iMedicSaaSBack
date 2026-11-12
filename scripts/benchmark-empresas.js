/**
 * Benchmark de latencia por empresa: mismos endpoints, mismos parámetros.
 *
 * Uso:
 *   BENCH_CREDS="usuario:clave,usuario2:clave2" node scripts/benchmark-empresas.js [etiqueta]
 *   BENCH_API (default producción), BENCH_N (repeticiones, default 5)
 *
 * Por endpoint mide: tiempo visto por el cliente, `Server-Timing` (total del back,
 * SQL Server y MySQL con cantidad de queries), bytes y filas. Guarda JSON en
 * scripts/bench-results/<etiqueta>.json y muestra un resumen.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BENCH_API || 'https://imedicsaasback-production.up.railway.app/api';
const N = Number(process.env.BENCH_N) || 5;
const ETIQUETA = process.argv[2] || `bench-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;

// Mismo período para todas las empresas (volumen comparable).
const MES_INI = '2026-10-01';
const MES_FIN = '2026-10-31';
const SEMANA_INI = '2026-11-02';
const SEMANA_FIN = '2026-11-08';
const HOY = new Date().toISOString().slice(0, 10);

function parseServerTiming(h) {
	const out = {};
	for (const parte of String(h || '').split(',')) {
		const [nombre, ...attrs] = parte.trim().split(';');
		if (!nombre) continue;
		const o = {};
		for (const a of attrs) {
			const [k, v] = a.split('=');
			if (k === 'dur') o.dur = Number(v);
			if (k === 'desc') {
				const m = String(v).match(/x(\d+)/);
				if (m) o.n = Number(m[1]);
			}
		}
		out[nombre] = o;
	}
	return out;
}

function contarFilas(json) {
	const d = json?.data ?? json;
	if (Array.isArray(d)) return d.length;
	if (d && typeof d === 'object') {
		for (const k of ['camas', 'rows', 'items', 'turnos', 'slots', 'data', 'resultados']) {
			if (Array.isArray(d[k])) return d[k].length;
		}
	}
	return null;
}

async function http(method, ruta, { token, body } = {}) {
	const t0 = performance.now();
	const r = await fetch(BASE + ruta, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const texto = await r.text();
	const ms = performance.now() - t0;
	let json = null;
	try {
		json = JSON.parse(texto);
	} catch {
		/* no JSON */
	}
	return { status: r.status, ms, bytes: Buffer.byteLength(texto), json, st: parseServerTiming(r.headers.get('server-timing')) };
}

async function login(username, password) {
	let r = await http('POST', '/auth/login', { body: { username, password } });
	if (r.json?.empresas && !r.json?.token) {
		const emp = r.json.empresas[0];
		r = await http('POST', '/auth/login', {
			body: { username, password, idEmpresa: emp.idEmpresa ?? emp.IdEmpresa, tempToken: r.json.tempToken },
		});
	}
	const token = r.json?.token || r.json?.data?.token;
	if (!token) throw new Error(`login ${username}: HTTP ${r.status} ${r.json?.mensaje || ''}`);
	return {
		token,
		idEmpresa: r.json.idEmpresa,
		empresa: r.json.empresaSeleccionada?.descripcion || r.json.empresaSeleccionada?.nombre || String(r.json.idEmpresa),
		matricula: r.json.usuario?.matricula,
	};
}

const pct = (arr, p) => {
	if (!arr.length) return null;
	const s = [...arr].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mediana = (arr) => pct(arr, 50);

async function medirEndpoint(sesion, nombre, ruta) {
	const muestras = [];
	const warm = await http('GET', ruta, { token: sesion.token });
	if (warm.status >= 400) {
		return { nombre, ruta, status: warm.status, omitido: true, motivo: warm.json?.mensaje || warm.json?.message };
	}
	for (let i = 0; i < N; i++) muestras.push(await http('GET', ruta, { token: sesion.token }));
	const ok = muestras.filter((m) => m.status < 400);
	const v = (f) => ok.map(f).filter((x) => Number.isFinite(x));
	return {
		nombre,
		ruta,
		status: muestras[muestras.length - 1].status,
		n: ok.length,
		clienteP50: mediana(v((m) => m.ms)),
		clienteP95: pct(v((m) => m.ms), 95),
		backP50: mediana(v((m) => m.st.total?.dur)),
		sqlP50: mediana(v((m) => m.st.sqlserver?.dur)),
		sqlQueries: mediana(v((m) => m.st.sqlserver?.n)),
		mysqlP50: mediana(v((m) => m.st.mysql?.dur)),
		mysqlQueries: mediana(v((m) => m.st.mysql?.n)),
		bytes: ok[0]?.bytes ?? null,
		filas: contarFilas(ok[0]?.json),
		_json: ok[0]?.json,
	};
}

async function benchEmpresa(username, password) {
	const sesion = await login(username, password);
	const resultados = [];
	const medir = async (nombre, ruta) => {
		const r = await medirEndpoint(sesion, nombre, ruta);
		resultados.push(r);
		return r;
	};

	await medir('auth/me (MySQL + overhead)', '/auth/me');
	await medir('catálogo trivial (RTT SQL)', '/sexo');
	await medir('dashboard/resumen', '/dashboard/resumen');
	const camas = await medir('beds (todas las camas)', '/beds');
	await medir('beds/bootstrap', '/beds/bootstrap');
	await medir('indicadores/ambulatorio (mes)', `/indicadores/ambulatorio?fechaInicio=${MES_INI}&fechaFin=${MES_FIN}&graciaMin=15`);
	await medir('indicadores/camas/resumen', `/indicadores/camas/resumen?fechaInicio=${MES_INI}&fechaFin=${MES_FIN}`);
	await medir('admission-search (mes, 50)', `/admission-search?fechaInicio=${MES_INI}&fechaFin=${MES_FIN}&porIngreso=true&page=1&limit=50`);
	const profs = await medir('agenda/profesionales', '/agenda/profesionales');

	const listaProf = Array.isArray(profs._json?.data) ? profs._json.data : [];
	const mat = Number(listaProf[0]?.matricula ?? listaProf[0]?.Matricula ?? listaProf[0]?.valor ?? 0);
	if (mat > 0) {
		await medir('agenda slots (semana, 1 prof.)', `/agenda/${mat}/slots?desde=${SEMANA_INI}&hasta=${SEMANA_FIN}`);
		await medir('agenda dias-agenda (mes, 1 prof.)', `/agenda/${mat}/dias-agenda?desde=${MES_INI}&hasta=${MES_FIN}`);
	}

	const listaCamas = Array.isArray(camas._json?.data) ? camas._json.data : [];
	const ocupada = listaCamas.find((c) => Number(c.NumeroVisita) > 0);
	if (ocupada) {
		const idCama = ocupada.IdCama ?? ocupada.idCama ?? ocupada.Id ?? ocupada.id;
		if (idCama != null) await medir('beds/:id (header paciente)', `/beds/${encodeURIComponent(idCama)}`);
		await medir('indicaciones byDate (1 visita)', `/indicaciones/${ocupada.NumeroVisita}/byDate?date=${HOY}`);
		await medir('insumos byDate (1 visita)', `/indicaciones/${ocupada.NumeroVisita}/insumos/byDate?date=${HOY}`);
	}

	await medir('almacen/stock', '/almacen/stock?page=1&limit=50');
	await medir('almacen/remitos', '/almacen/remitos?page=1&limit=50');

	for (const r of resultados) delete r._json;
	return { username, empresa: sesion.empresa, idEmpresa: sesion.idEmpresa, resultados };
}

function fmt(n) {
	return n == null ? '—' : Math.round(n).toString();
}

(async () => {
	const creds = String(process.env.BENCH_CREDS || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => {
			const i = s.indexOf(':');
			return [s.slice(0, i), s.slice(i + 1)];
		});
	if (!creds.length) {
		console.error('Definí BENCH_CREDS="usuario:clave,..."');
		process.exit(1);
	}

	const salida = { etiqueta: ETIQUETA, fecha: new Date().toISOString(), base: BASE, n: N, empresas: [] };
	for (const [u, p] of creds) {
		process.stdout.write(`→ ${u}… `);
		try {
			const r = await benchEmpresa(u, p);
			salida.empresas.push(r);
			console.log(`${r.empresa} (id ${r.idEmpresa}) ok`);
		} catch (e) {
			salida.empresas.push({ username: u, error: e.message });
			console.log(`ERROR ${e.message}`);
		}
	}

	const dir = path.join(__dirname, 'bench-results');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${ETIQUETA}.json`), JSON.stringify(salida, null, 2));

	for (const e of salida.empresas) {
		if (e.error) continue;
		console.log(`\n== ${e.empresa} (id ${e.idEmpresa})`);
		console.log('endpoint | cliente p50 | p95 | back p50 | SQL ms (n) | MySQL ms (n) | filas | KB');
		for (const r of e.resultados) {
			if (r.omitido) {
				console.log(`${r.nombre} | omitido (${r.status} ${r.motivo || ''})`);
				continue;
			}
			console.log(
				`${r.nombre} | ${fmt(r.clienteP50)} | ${fmt(r.clienteP95)} | ${fmt(r.backP50)} | ${fmt(r.sqlP50)} (${fmt(r.sqlQueries)}) | ${fmt(r.mysqlP50)} (${fmt(r.mysqlQueries)}) | ${r.filas ?? '—'} | ${r.bytes != null ? (r.bytes / 1024).toFixed(1) : '—'}`,
			);
		}
	}
	console.log(`\nGuardado en scripts/bench-results/${ETIQUETA}.json`);
	process.exit(0);
})().catch((e) => {
	console.error('ERR', e?.message || e);
	process.exit(1);
});
