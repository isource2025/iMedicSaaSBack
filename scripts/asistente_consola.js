/**
 * Consola del asistente de plataforma.
 * Uso:
 *   ASISTENTE_TOKEN=<jwt> node scripts/asistente_consola.js
 *   node scripts/asistente_consola.js --base http://localhost:5000 --ruta /dashboard/beds
 */
require('dotenv').config();
const readline = require('readline');

const args = process.argv.slice(2);
function flag(name, def) {
	const i = args.indexOf(`--${name}`);
	if (i >= 0 && args[i + 1]) return args[i + 1];
	return def;
}

const BASE = String(flag('base', process.env.ASISTENTE_BASE || 'http://127.0.0.1:5000')).replace(/\/+$/, '');
const TOKEN = String(flag('token', process.env.ASISTENTE_TOKEN || process.env.TOKEN || '')).trim();
const RUTA = flag('ruta', '/dashboard');

if (!TOKEN) {
	console.error('Falta ASISTENTE_TOKEN (JWT de un usuario logueado).');
	process.exit(1);
}

let idConversacion = null;

async function post(path, body) {
	const resp = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	const data = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		throw new Error(data.mensaje || `HTTP ${resp.status}`);
	}
	return data;
}

async function main() {
	console.log(`Asistente iMedic → ${BASE}  (ruta ${RUTA})`);
	console.log('Escribí un mensaje. /nueva limpia la sesión. /salir termina.\n');
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = () =>
		new Promise((resolve) => {
			rl.question('vos> ', resolve);
		});

	while (true) {
		const line = String(await ask()).trim();
		if (!line) continue;
		if (line === '/salir' || line === '/exit') break;
		if (line === '/nueva') {
			const s = await post('/api/asistente/sesion', { rutaActual: RUTA });
			idConversacion = s.idConversacion;
			console.log('(sesión nueva)\n');
			continue;
		}
		try {
			const r = await post('/api/asistente/mensaje', {
				mensaje: line,
				rutaActual: RUTA,
				idConversacion,
			});
			idConversacion = r.idConversacion || idConversacion;
			console.log(`asistente> ${r.texto}`);
			if (r.pendientes?.length) {
				for (const p of r.pendientes) {
					console.log(`  [pendiente ${p.id}] ${p.resumen}`);
				}
			}
			if (r.navegaciones?.length) {
				for (const n of r.navegaciones) console.log(`  [ir] ${n.href}`);
			}
			console.log('');
		} catch (err) {
			console.error('error:', err.message);
		}
	}
	rl.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
