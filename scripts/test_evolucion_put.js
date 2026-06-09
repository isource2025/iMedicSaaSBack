/**
 * Simula producción: login + PUT /api/evoluciones/:id
 * Uso: node scripts/test_evolucion_put.js [username] [password] [idEvolucion]
 */
require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 5006}/api`;

async function request(method, path, { token, body } = {}) {
	const headers = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text };
	}
	return { status: res.status, json };
}

async function main() {
	const username = process.argv[2] || process.env.TEST_LOGIN_USER;
	const password = process.argv[3] || process.env.TEST_LOGIN_PASSWORD;
	const idEvol = Number(process.argv[4] || process.env.TEST_EVOLUCION_ID || 1);

	if (!username || !password) {
		console.error('Uso: node scripts/test_evolucion_put.js <user> <pass> [idEvolucion]');
		console.error('O definir TEST_LOGIN_USER y TEST_LOGIN_PASSWORD en .env');
		process.exit(1);
	}

	console.log('1) Descubrir empresas…');
	const emp = await request('GET', `/auth/empresas/${encodeURIComponent(username)}`);
	console.log('   ', emp.status, emp.json?.data?.length ?? 0, 'empresa(s)');

	const idEmpresa = emp.json?.data?.[0]?.idEmpresa ?? 1;

	console.log('2) Login…');
	const login = await request('POST', '/auth/login', {
		body: { username, password, idEmpresa },
	});
	if (login.status !== 200 || !login.json?.token) {
		console.error('Login falló:', login.status, login.json);
		process.exit(1);
	}
	const token = login.json.token;
	const u = login.json.usuario || {};
	console.log('   OK — ValorPersonal:', u.valorPersonal ?? u.ValorPersonal, 'matricula en JWT decodificada omitida');

	console.log('3) GET evolución', idEvol, '…');
	const get = await request('GET', `/evoluciones/${idEvol}`, { token });
	console.log('   ', get.status, get.json?.success ? 'encontrada' : get.json?.mensaje);

	console.log('4) PUT evolución (simula edición)…');
	const ev = get.json?.data || {};
	const put = await request('PUT', `/evoluciones/${idEvol}`, {
		token,
		body: {
			FechaEv: ev.FechaEv || '2026-06-06',
			HoraEv: ev.HoraEv || '10:00',
			IdSector: ev.IdSector || '1',
			Evolucion: (ev.Evolucion || 'Prueba edición') + ' [test]',
			NumeroDocumento: ev.NumeroDocumento || '0',
		},
	});
	console.log('   ', put.status, put.json?.mensaje || put.json);

	if (put.status === 200) {
		console.log('\n✓ Edición OK (flujo producción simulado)');
		process.exit(0);
	}
	console.error('\n✗ Edición falló');
	process.exit(1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
