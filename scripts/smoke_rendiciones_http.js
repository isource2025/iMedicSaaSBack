/**
 * Prueba de humo HTTP (solo lectura) de /api/rendiciones contra el backend local.
 * Uso: node scripts/smoke_rendiciones_http.js [puerto]
 */
require('dotenv').config();
const { SA_USER, SA_PASS } = require('../src/config/tenantIdentity');

const BASE = `http://localhost:${process.argv[2] || process.env.PORT || 5006}/api`;

(async () => {
	const login = await fetch(`${BASE}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: SA_USER, password: SA_PASS }),
	});
	const sesion = await login.json();
	const token = sesion?.data?.token || sesion?.token;
	if (!token) {
		console.log('login sin token:', login.status);
		process.exit(1);
	}
	const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const pedir = async (metodo, ruta, body, headers = h) => {
		const t = Date.now();
		const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
		const j = await r.json().catch(() => ({}));
		console.log(`${r.status} ${metodo} ${ruta} (${Date.now() - t} ms)${j.success === false ? ` → ${j.mensaje}` : ''}`);
		return j.data;
	};

	await pedir('GET', '/rendiciones', null, { 'Content-Type': 'application/json' });
	const [cat, lista] = await Promise.all([pedir('GET', '/rendiciones/catalogos'), pedir('GET', '/rendiciones?pagina=1&tamPagina=50')]);
	console.log('   clientes', cat?.clientes?.length, 'total', lista?.total);
	await pedir('GET', '/rendiciones?desde=2026-01&hasta=2026-12&estado=abierta&q=amb');
	await pedir('GET', '/rendiciones?desde=2026-13');
	await pedir('GET', '/rendiciones/7032');
	await pedir('GET', '/rendiciones/7032/visitas?q=mozer');
	await pedir('GET', '/rendiciones/6978/lineas?tipo=H&tamPagina=5');
	await pedir('GET', '/rendiciones/6978/lineas?tipo=Z');
	await pedir('GET', '/rendiciones/6978/facturas');
	await pedir('GET', '/rendiciones/exportar?desde=2026-01');
	await pedir('GET', '/rendiciones/999999');
	await pedir('PUT', '/rendiciones/7032', { periodo: '2026-01' });
	await pedir('DELETE', '/rendiciones/7032');
	await pedir('POST', '/rendiciones', {});
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
