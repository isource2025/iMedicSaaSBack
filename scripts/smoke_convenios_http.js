/**
 * Prueba de humo HTTP (solo lectura) de /api/convenios contra el backend local.
 * Uso: node scripts/smoke_convenios_http.js [puerto]
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
		console.log('login sin token:', login.status, JSON.stringify(sesion).slice(0, 300));
		process.exit(1);
	}
	const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const pedir = async (metodo, ruta, body) => {
		const t = Date.now();
		const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: h, body: body ? JSON.stringify(body) : undefined });
		const j = await r.json().catch(() => ({}));
		console.log(`${r.status} ${metodo} ${ruta} (${Date.now() - t} ms)${j.success === false ? ` → ${j.mensaje}` : ''}`);
		return j.data;
	};

	const cat = await pedir('GET', '/convenios/catalogos');
	console.log('   pestañas', cat?.pestanas?.map((p) => p.id).join(','));
	const lista = await pedir('GET', '/convenios?estado=vigente&tamPagina=3');
	console.log('   ', JSON.stringify(lista?.resumen));
	const cod = lista?.filas?.[0]?.codigo;
	await pedir('GET', `/convenios/${cod}`);
	await pedir('GET', `/convenios/${cod}/uso`);
	const nom = await pedir('GET', `/convenios/${cod}/pestanas/nomenclador?tamPagina=2&q=consulta`);
	console.log('   ', nom?.total, 'filas con "consulta"');
	await pedir('GET', `/convenios/${cod}/pestanas/nada`);
	await pedir('GET', '/convenios/catalogos/vademecum/buscar?q=amoxi');
	await pedir('POST', `/convenios/${cod}/ajuste/preview`, { porcentaje: 3 });
	await pedir('POST', `/convenios/${cod}/pestanas/valores/lote`, {});
	await pedir('PUT', `/convenios/${cod}`, { Descripcion: '' });
	await pedir('GET', '/convenios/999999');
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
