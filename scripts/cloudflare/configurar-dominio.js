#!/usr/bin/env node
/**
 * Configura por CLI el DNS de imedic.com.ar en Cloudflare.
 *
 * Deja los registros de la aplicacion (Vercel) y de la API (Railway). Los
 * hostnames de las clinicas (files-*) NO se tocan aca: los crea cloudflared
 * cuando se corre scripts/tunnel/Instalar-Clinica.ps1 en cada PC.
 *
 * Uso:
 *   CF_API_TOKEN=xxx node scripts/cloudflare/configurar-dominio.js
 *   CF_API_TOKEN=xxx node scripts/cloudflare/configurar-dominio.js --aplicar
 *
 * Sin --aplicar solo muestra que cambiaria.
 *
 * El token se saca de https://dash.cloudflare.com/profile/api-tokens con el
 * permiso Zone > DNS > Edit sobre la zona del dominio.
 */
const API = 'https://api.cloudflare.com/client/v4';

const TOKEN = (process.env.CF_API_TOKEN || '').trim();
const DOMINIO = process.env.IMEDIC_DOMINIO || 'imedic.com.ar';
const APLICAR = process.argv.includes('--aplicar');

/** Destino de un proyecto de Vercel con dominio propio. */
const VERCEL_CNAME = process.env.VERCEL_CNAME || 'cname.vercel-dns.com';
/** Dominio publico que da Railway al backend. */
const API_CNAME = process.env.API_CNAME || '';

/**
 * proxied=false (DNS only) porque Vercel y Railway ya terminan TLS y manejan
 * su propio CDN; con el proxy de Cloudflare encima se rompe la validacion del
 * certificado. Los files-* de las clinicas SI van proxeados, y de eso se
 * encarga cloudflared.
 */
const REGISTROS = [
	{ name: 'app', type: 'CNAME', content: VERCEL_CNAME, proxied: false },
	{ name: '@', type: 'CNAME', content: VERCEL_CNAME, proxied: false },
	{ name: 'www', type: 'CNAME', content: VERCEL_CNAME, proxied: false },
	{ name: 'api', type: 'CNAME', content: API_CNAME, proxied: false },
];

async function cf(ruta, opciones = {}) {
	const res = await fetch(`${API}${ruta}`, {
		...opciones,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			'Content-Type': 'application/json',
			...(opciones.headers || {}),
		},
	});

	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) {
		const detalle = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
		throw new Error(detalle || `HTTP ${res.status} en ${ruta}`);
	}
	return body.result;
}

function fqdn(name) {
	return name === '@' ? DOMINIO : `${name}.${DOMINIO}`;
}

async function main() {
	if (!TOKEN) {
		console.error('Falta CF_API_TOKEN.');
		console.error('  Crealo en https://dash.cloudflare.com/profile/api-tokens (Zone > DNS > Edit)');
		console.error(`  y corre:  $env:CF_API_TOKEN="xxx"; node ${process.argv[1]}`);
		process.exit(1);
	}

	const zonas = await cf(`/zones?name=${encodeURIComponent(DOMINIO)}`);
	if (!zonas.length) {
		console.error(`El dominio ${DOMINIO} no esta en esta cuenta de Cloudflare.`);
		console.error('  1. https://dash.cloudflare.com > Add a site > ' + DOMINIO);
		console.error('  2. Copia los 2 nameservers que te da Cloudflare.');
		console.error('  3. Ponelos en nic.ar > Mis dominios > ' + DOMINIO + ' > Delegaciones.');
		console.error('  4. Espera la propagacion y volve a correr este script.');
		process.exit(1);
	}

	const zona = zonas[0];
	console.log(`Zona ${DOMINIO} (${zona.id})`);
	console.log(`  estado: ${zona.status}`);
	console.log(`  nameservers: ${(zona.name_servers || []).join(', ')}`);

	if (zona.status !== 'active') {
		console.log('');
		console.log(`  La zona todavia no esta activa. En nic.ar hay que delegar ${DOMINIO} a:`);
		for (const ns of zona.name_servers || []) console.log(`      ${ns}`);
		console.log('  Se pueden crear los registros igual, empiezan a resolver cuando active.');
	}

	const existentes = await cf(`/zones/${zona.id}/dns_records?per_page=200`);
	const porNombre = new Map(existentes.map((r) => [`${r.type}:${r.name}`, r]));

	console.log('');
	console.log('Registros de la aplicacion:');

	for (const reg of REGISTROS) {
		const nombre = fqdn(reg.name);

		if (!reg.content) {
			console.log(`  ~ ${nombre.padEnd(28)} sin destino configurado, se saltea`);
			if (reg.name === 'api') {
				console.log('      (seteá API_CNAME con el dominio que da Railway)');
			}
			continue;
		}

		const actual = porNombre.get(`${reg.type}:${nombre}`);
		const payload = {
			type: reg.type,
			name: nombre,
			content: reg.content,
			proxied: reg.proxied,
			ttl: 1,
		};

		if (actual && actual.content === reg.content && actual.proxied === reg.proxied) {
			console.log(`  = ${nombre.padEnd(28)} -> ${reg.content}`);
			continue;
		}

		const verbo = actual ? 'actualiza' : 'crea';
		if (!APLICAR) {
			console.log(`  ${actual ? '~' : '+'} ${nombre.padEnd(28)} -> ${reg.content}  (${verbo})`);
			continue;
		}

		if (actual) {
			await cf(`/zones/${zona.id}/dns_records/${actual.id}`, {
				method: 'PUT',
				body: JSON.stringify(payload),
			});
		} else {
			await cf(`/zones/${zona.id}/dns_records`, {
				method: 'POST',
				body: JSON.stringify(payload),
			});
		}
		console.log(`  ${actual ? '~' : '+'} ${nombre.padEnd(28)} -> ${reg.content}  (${verbo} OK)`);
	}

	const clinicas = existentes.filter((r) => r.name.startsWith('files-'));
	console.log('');
	console.log(`Hostnames de clinicas (${clinicas.length}):`);
	if (!clinicas.length) {
		console.log('  ninguno todavia. Se crean corriendo Instalar-Clinica.ps1 en cada PC.');
	}
	for (const r of clinicas) {
		console.log(`  = ${r.name.padEnd(28)} -> ${r.content} ${r.proxied ? '(proxied)' : ''}`);
	}

	if (!APLICAR) {
		console.log('');
		console.log('Simulacion. Volve a correr con --aplicar para escribir los cambios.');
	}
}

main().catch((e) => {
	console.error(`\nError: ${e.message}`);
	process.exit(1);
});
