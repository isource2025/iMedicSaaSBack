#!/usr/bin/env node
/**
 * Configura Cloudflare por CLI: la zona del dominio y los tuneles de cada
 * clinica. Los tuneles quedan "administrados por Cloudflare" (config_src =
 * cloudflare), asi que el ingress se define aca por API y en la PC de la
 * clinica no hay login por navegador, ni cert.pem, ni config.yml.
 *
 * Subcomandos:
 *   estado                Muestra cuenta, zona, DNS y tuneles.
 *   zona                  Crea la zona si falta y carga app/api/www.
 *   clinica <slug>        Crea el tunel de una clinica y su hostname.
 *
 * Sin --aplicar todo es simulacion: no escribe nada.
 *
 * El token sale de CF_API_TOKEN (.env). Permisos necesarios:
 *   Account > Cloudflare Tunnel > Edit
 *   Account > Account Settings > Read
 *   Zone > Zone > Edit
 *   Zone > DNS > Edit
 */
const path = require('path');

try {
	require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch {
	/* dotenv es opcional: tambien sirve exportar la variable a mano */
}

const API = 'https://api.cloudflare.com/client/v4';
const TOKEN = (process.env.CF_API_TOKEN || '').trim();
const DOMINIO = (process.env.IMEDIC_DOMINIO || 'imedic.com.ar').trim();

/** Destino de un proyecto de Vercel con dominio propio. */
const VERCEL_CNAME = (process.env.VERCEL_CNAME || 'cname.vercel-dns.com').trim();
/** Dominio publico que da Railway al backend. Sin esto, `api` se saltea. */
const API_CNAME = (process.env.API_CNAME || '').trim();

const args = process.argv.slice(2);
const comando = args[0] || 'estado';
const APLICAR = args.includes('--aplicar');

function flag(nombre, porDefecto) {
	const i = args.indexOf(`--${nombre}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
}

// ------------------------------------------------------------------- salida

const c = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
};
const titulo = (m) => console.log(`\n${c.cyan}${m}${c.reset}`);
const ok = (m) => console.log(`  ${c.green}ok${c.reset}   ${m}`);
const mal = (m) => console.log(`  ${c.red}mal${c.reset}  ${m}`);
const aviso = (m) => console.log(`  ${c.yellow}!${c.reset}    ${m}`);
const dato = (m) => console.log(`       ${c.dim}${m}${c.reset}`);

// ---------------------------------------------------------------- api client

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
		const detalle = (body.errors || [])
			.map((e) => `${e.code}: ${e.message}${e.error_chain ? ` (${e.error_chain.map((x) => x.message).join(', ')})` : ''}`)
			.join('; ');
		const err = new Error(detalle || `HTTP ${res.status} en ${ruta}`);
		err.status = res.status;
		err.codes = (body.errors || []).map((e) => e.code);
		throw err;
	}
	return body.result;
}

async function getCuenta() {
	const cuentas = await cf('/accounts');
	if (!cuentas.length) throw new Error('El token no ve ninguna cuenta de Cloudflare.');
	if (cuentas.length > 1 && !process.env.CF_ACCOUNT_ID) {
		aviso(`hay ${cuentas.length} cuentas; uso la primera. Fija CF_ACCOUNT_ID para elegir otra.`);
	}
	if (process.env.CF_ACCOUNT_ID) {
		const elegida = cuentas.find((a) => a.id === process.env.CF_ACCOUNT_ID.trim());
		if (elegida) return elegida;
	}
	return cuentas[0];
}

async function getZona() {
	const zonas = await cf(`/zones?name=${encodeURIComponent(DOMINIO)}`);
	return zonas[0] || null;
}

async function getRegistros(zonaId) {
	return cf(`/zones/${zonaId}/dns_records?per_page=500`);
}

async function getTuneles(cuentaId) {
	return cf(`/accounts/${cuentaId}/cfd_tunnel?is_deleted=false&per_page=200`);
}

/**
 * Deja un registro DNS con el contenido pedido. Devuelve 'igual' | 'creado' |
 * 'actualizado' | 'simulado'.
 */
async function upsertRegistro(zonaId, existentes, { nombre, tipo, contenido, proxied }) {
	const fqdn = nombre === '@' ? DOMINIO : `${nombre}.${DOMINIO}`;
	const actual = existentes.find((r) => r.name === fqdn && (r.type === tipo || r.type === 'CNAME' || r.type === 'A'));

	if (actual && actual.type === tipo && actual.content === contenido && actual.proxied === proxied) {
		return { estado: 'igual', fqdn };
	}
	if (!APLICAR) {
		return { estado: actual ? 'actualizado' : 'creado', fqdn, simulado: true };
	}

	const payload = { type: tipo, name: fqdn, content: contenido, proxied, ttl: 1 };
	if (actual) {
		await cf(`/zones/${zonaId}/dns_records/${actual.id}`, {
			method: 'PUT',
			body: JSON.stringify(payload),
		});
		return { estado: 'actualizado', fqdn };
	}
	await cf(`/zones/${zonaId}/dns_records`, { method: 'POST', body: JSON.stringify(payload) });
	return { estado: 'creado', fqdn };
}

function mostrarRegistro(r) {
	const marca = { igual: '=', creado: '+', actualizado: '~' }[r.estado];
	const sufijo = r.simulado ? ` ${c.dim}(simulado)${c.reset}` : '';
	console.log(`  ${marca} ${r.fqdn.padEnd(32)} ${r.detalle || ''}${sufijo}`);
}

// -------------------------------------------------------------------- estado

async function cmdEstado() {
	const cuenta = await getCuenta();
	titulo('Cuenta');
	ok(`${cuenta.name}`);
	dato(`id ${cuenta.id}`);

	titulo(`Zona ${DOMINIO}`);
	const zona = await getZona();
	if (!zona) {
		mal('la zona no existe en esta cuenta');
		dato('Creala con:  node scripts/cloudflare/cf-setup.js zona --aplicar');
		return;
	}

	if (zona.status === 'active') {
		ok(`activa (id ${zona.id})`);
	} else {
		aviso(`estado "${zona.status}": Cloudflare todavia no es autoritativo`);
		dato('En nic.ar > Mis dominios > Delegaciones hay que cargar estos nameservers:');
		for (const ns of zona.name_servers || []) dato(`    ${ns}`);
	}

	const registros = await getRegistros(zona.id);
	titulo('Registros DNS');
	if (!registros.length) console.log(`  ${c.dim}ninguno${c.reset}`);
	for (const r of registros.sort((a, b) => a.name.localeCompare(b.name))) {
		const proxy = r.proxied ? `${c.dim}proxied${c.reset}` : `${c.dim}dns-only${c.reset}`;
		console.log(`  ${r.type.padEnd(6)} ${r.name.padEnd(32)} -> ${String(r.content).padEnd(42)} ${proxy}`);
	}

	titulo('Tuneles');
	const tuneles = await getTuneles(cuenta.id);
	if (!tuneles.length) console.log(`  ${c.dim}ninguno${c.reset}`);
	for (const t of tuneles) {
		const conectado = (t.connections || []).length > 0;
		const estado = conectado
			? `${c.green}conectado${c.reset} (${t.connections.length} conexion/es)`
			: `${c.red}sin conexiones${c.reset}`;
		console.log(`  ${t.name.padEnd(24)} ${estado}`);
		dato(`id ${t.id}  config ${t.conn_active_at ? '' : ''}${t.config_src || 'local'}`);
	}
}

// ---------------------------------------------------------------------- zona

async function cmdZona() {
	const cuenta = await getCuenta();
	titulo('Cuenta');
	ok(`${cuenta.name} (${cuenta.id})`);

	titulo(`Zona ${DOMINIO}`);
	let zona = await getZona();

	if (!zona) {
		if (!APLICAR) {
			console.log(`  + ${DOMINIO} ${c.dim}(se crearia)${c.reset}`);
			console.log(`\n${c.dim}Simulacion. Corre con --aplicar para crearla.${c.reset}`);
			return;
		}
		zona = await cf('/zones', {
			method: 'POST',
			body: JSON.stringify({ name: DOMINIO, account: { id: cuenta.id }, type: 'full' }),
		});
		ok('zona creada');
	} else {
		ok(`la zona ya existe (estado "${zona.status}")`);
	}

	console.log('');
	console.log(`${c.yellow}  Nameservers que hay que cargar en nic.ar:${c.reset}`);
	for (const ns of zona.name_servers || []) console.log(`${c.cyan}      ${ns}${c.reset}`);
	console.log(`${c.dim}      nic.ar > Mis dominios > ${DOMINIO} > Delegaciones${c.reset}`);

	// app/api/www apuntan a Vercel y Railway, que ya terminan TLS por su lado:
	// con el proxy de Cloudflare encima se rompe la validacion del certificado.
	const deseados = [
		{ nombre: '@', tipo: 'CNAME', contenido: VERCEL_CNAME, proxied: false },
		{ nombre: 'www', tipo: 'CNAME', contenido: VERCEL_CNAME, proxied: false },
		{ nombre: 'app', tipo: 'CNAME', contenido: VERCEL_CNAME, proxied: false },
		{ nombre: 'api', tipo: 'CNAME', contenido: API_CNAME, proxied: false },
	];

	titulo('Registros de la aplicacion');
	const existentes = await getRegistros(zona.id);
	for (const d of deseados) {
		if (!d.contenido) {
			console.log(`  ${c.dim}~ ${d.nombre}.${DOMINIO} sin destino, se saltea${c.reset}`);
			if (d.nombre === 'api') dato('fija API_CNAME con el dominio que da Railway');
			continue;
		}
		const r = await upsertRegistro(zona.id, existentes, d);
		r.detalle = `-> ${d.contenido}`;
		mostrarRegistro(r);
	}

	if (!APLICAR) console.log(`\n${c.dim}Simulacion. Corre con --aplicar para escribir.${c.reset}`);
	else {
		console.log('');
		console.log('  Falta: en Vercel agregar los dominios del proyecto,');
		console.log(`  y en nic.ar delegar ${DOMINIO} a los nameservers de arriba.`);
	}
}

// ------------------------------------------------------------------- clinica

async function cmdClinica() {
	const slug = args[1];
	if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
		throw new Error('Falta el slug de la clinica en minusculas. Ej: cf-setup.js clinica vidal');
	}

	const root = flag('root', 'E:\\adjuntos');
	const port = Number(flag('port', '9012'));
	const nombreTunel = `imedic-${slug}`;
	const hostname = `files-${slug}.${DOMINIO}`;

	const cuenta = await getCuenta();
	const zona = await getZona();
	if (!zona) throw new Error(`La zona ${DOMINIO} no existe todavia. Corre primero: cf-setup.js zona --aplicar`);

	titulo(`Clinica ${slug}`);
	dato(`tunel     ${nombreTunel}`);
	dato(`hostname  https://${hostname}`);
	dato(`origen    http://127.0.0.1:${port}`);
	dato(`carpeta   ${root}`);

	// ------------------------------------------------------------ el tunel
	titulo('Tunel');
	const tuneles = await getTuneles(cuenta.id);
	let tunel = tuneles.find((t) => t.name === nombreTunel);

	if (tunel) {
		ok(`ya existe (${tunel.id})`);
		if (tunel.config_src !== 'cloudflare') {
			aviso(`esta administrado localmente ("${tunel.config_src}"), no por API`);
			dato('Borralo en el dashboard y volve a correr este comando para recrearlo.');
		}
	} else if (!APLICAR) {
		console.log(`  + ${nombreTunel} ${c.dim}(se crearia)${c.reset}`);
	} else {
		tunel = await cf(`/accounts/${cuenta.id}/cfd_tunnel`, {
			method: 'POST',
			body: JSON.stringify({ name: nombreTunel, config_src: 'cloudflare' }),
		});
		ok(`creado (${tunel.id})`);
	}

	// -------------------------------------------------------- el ingress
	titulo('Ingress');
	const ingress = [
		{
			hostname,
			service: `http://127.0.0.1:${port}`,
			originRequest: { connectTimeout: '30s' },
		},
		// Cloudflare exige una regla final sin hostname.
		{ service: 'http_status:404' },
	];

	if (!tunel) {
		console.log(`  ${c.dim}~ se define al crear el tunel${c.reset}`);
	} else if (!APLICAR) {
		console.log(`  ~ ${hostname} -> http://127.0.0.1:${port} ${c.dim}(se definiria)${c.reset}`);
	} else {
		await cf(`/accounts/${cuenta.id}/cfd_tunnel/${tunel.id}/configurations`, {
			method: 'PUT',
			body: JSON.stringify({ config: { ingress } }),
		});
		ok(`${hostname} -> http://127.0.0.1:${port}`);
	}

	// ------------------------------------------------------------- el dns
	titulo('DNS');
	if (!tunel) {
		console.log(`  ${c.dim}~ se crea junto con el tunel${c.reset}`);
	} else {
		const existentes = await getRegistros(zona.id);
		const r = await upsertRegistro(zona.id, existentes, {
			nombre: `files-${slug}`,
			tipo: 'CNAME',
			contenido: `${tunel.id}.cfargotunnel.com`,
			proxied: true, // los files-* SI van proxeados: el tunel es la unica entrada
		});
		r.detalle = `-> ${tunel.id}.cfargotunnel.com`;
		mostrarRegistro(r);
	}

	// ----------------------------------------------------- que correr alla
	if (!APLICAR || !tunel) {
		console.log(`\n${c.dim}Simulacion. Corre con --aplicar para crear el tunel.${c.reset}`);
		return;
	}

	const { token } = await cf(`/accounts/${cuenta.id}/cfd_tunnel/${tunel.id}/token`).then((t) => ({
		token: typeof t === 'string' ? t : t?.token,
	}));

	if (!token) throw new Error('Cloudflare no devolvio el token del tunel.');

	console.log('');
	console.log(`${c.yellow}  En la PC de ${slug}, como Administrador:${c.reset}`);
	console.log('');
	console.log(`${c.cyan}  .\\scripts\\tunnel\\Instalar-Clinica.ps1 \`
      -Clinica ${slug} \`
      -Root "${root}" \`
      -Port ${port} \`
      -TunnelToken "${token}"${c.reset}`);
	console.log('');
	console.log(`${c.dim}  Ese token es una credencial del tunel: no lo commitees.${c.reset}`);
	console.log('');
	console.log(`  Despues, en Super Admin > Empresas > ${slug} > FileServerUrl:`);
	console.log(`${c.cyan}      https://${hostname}${c.reset}`);
	console.log('');
}

// ---------------------------------------------------------------------- main

const COMANDOS = { estado: cmdEstado, zona: cmdZona, clinica: cmdClinica };

async function main() {
	if (!TOKEN) {
		console.error(`${c.red}Falta CF_API_TOKEN.${c.reset}`);
		console.error('  Crealo en https://dash.cloudflare.com/profile/api-tokens (Create Custom Token) con:');
		console.error('      Account > Cloudflare Tunnel > Edit');
		console.error('      Account > Account Settings > Read');
		console.error('      Zone > Zone > Edit');
		console.error('      Zone > DNS > Edit');
		console.error('  y ponelo en iMedicSaaSBack/.env como  CF_API_TOKEN=...');
		process.exit(1);
	}

	const fn = COMANDOS[comando];
	if (!fn) {
		console.error(`Subcomando desconocido: ${comando}`);
		console.error('Uso: cf-setup.js [estado|zona|clinica <slug>] [--aplicar]');
		process.exit(1);
	}

	await fn();
	console.log('');
}

main().catch((e) => {
	console.error(`\n${c.red}Error:${c.reset} ${e.message}`);
	if (e.codes?.includes(9109) || e.status === 403) {
		console.error(`${c.dim}El token no tiene permisos para esa operacion. Revisa la lista de arriba.${c.reset}`);
	}
	process.exit(1);
});
