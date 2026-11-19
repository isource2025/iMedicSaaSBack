#!/usr/bin/env node
/**
 * Chequeo de seguridad de los servidores de una clínica, desde afuera (como
 * lo vería cualquiera en Internet) y, si hay clave, como el backend.
 *
 *   node scripts/tunnel/verificar-servidores-clinica.js --empresa 101 \
 *     --fs https://files-sarmiento.imedic.com.ar --pacs https://pacs-sarmiento.imedic.com.ar
 *
 * Con FILE_SERVER_SIGNING_KEYS / PACS_SIGNING_KEYS / IMEDIC_SIGNING_MASTER en
 * el entorno prueba también un pedido firmado.
 *
 * Revisa: versión segura (security=v1), que sin credencial devuelva 401/503,
 * que no haya CORS abierto, que no acepte rutas absolutas fuera de la carpeta
 * y el desfase de reloj de la PC (los tokens firmados toleran 5 minutos).
 */
const axios = require('axios');
const { signRequest, clinicKeyFor, HEADER } = require('../../src/utils/signedFileToken');

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const empresa = Number(arg('empresa'));
const fsUrl = String(arg('fs') || '').replace(/\/+$/, '');
const pacsUrl = String(arg('pacs') || '').replace(/\/+$/, '');
let fallas = 0;

function ok(m) {
	console.log(`  OK   ${m}`);
}
function mal(m) {
	fallas++;
	console.log(`  MAL  ${m}`);
}

async function get(url, headers = {}) {
	return axios.get(url, { headers, timeout: 15000, validateStatus: () => true, responseType: 'text' });
}

async function revisar(nombre, base, servicio, rutaPrivada) {
	console.log(`\n${nombre}: ${base}`);
	const h = await get(`${base}/health`, { Origin: 'https://ejemplo-malicioso.test' });
	let health = {};
	try {
		health = JSON.parse(h.data);
	} catch {
		/* no JSON */
	}
	if (h.status !== 200 && h.status !== 503) return mal(`/health respondió ${h.status}`);
	if (health.security === 'v1') ok('versión con seguridad (security=v1)');
	else mal(`versión vieja (encoding=${health.encoding || health.service || '?'}): reinstalar`);
	const acao = h.headers['access-control-allow-origin'];
	if (!acao) ok('sin CORS abierto');
	else mal(`CORS abierto: Access-Control-Allow-Origin=${acao}`);
	if (health.root || health.fsRoot || health.unc) mal('/health sin credencial muestra rutas del disco');
	if (Number.isFinite(Number(health.epoch))) {
		const desfase = Math.abs(Math.floor(Date.now() / 1000) - Number(health.epoch));
		if (desfase > 120) mal(`reloj de la PC desfasado ${desfase}s (sincronizar la hora de Windows)`);
		else ok(`reloj OK (desfase ${desfase}s)`);
	}

	const anon = await get(`${base}${rutaPrivada}`);
	if (anon.status === 401 || anon.status === 503) ok(`sin credencial: ${anon.status}`);
	else mal(`sin credencial respondió ${anon.status} (tiene que ser 401)`);

	const key = clinicKeyFor(servicio, empresa);
	if (!key) {
		console.log('  --   sin clave de firma en el entorno: no se prueba el pedido firmado');
		return;
	}
	const url = `${base}${rutaPrivada}`;
	const token = signRequest({ key, idEmpresa: empresa, method: 'GET', url });
	const firmado = await get(url, { [HEADER]: token });
	if (firmado.status === 401) mal('el pedido firmado fue rechazado (clave distinta o reloj desfasado)');
	else ok(`pedido firmado aceptado (HTTP ${firmado.status})`);

	if (servicio === 'fs') {
		const fuera = `${base}/file?path=${encodeURIComponent(encodeURIComponent('C:\\Windows\\win.ini'))}`;
		const r = await get(fuera, { [HEADER]: signRequest({ key, idEmpresa: empresa, method: 'GET', url: fuera }) });
		if (r.status === 404 || r.status === 400) ok('ruta fuera de la carpeta de adjuntos: rechazada');
		else mal(`ruta fuera de la carpeta de adjuntos respondió ${r.status}`);
	}
}

(async () => {
	if (!Number.isInteger(empresa) || empresa <= 0 || (!fsUrl && !pacsUrl)) {
		console.error('Uso: --empresa <id> [--fs https://files-x.imedic.com.ar] [--pacs https://pacs-x.imedic.com.ar]');
		process.exit(2);
	}
	try {
		if (fsUrl) await revisar('File server', fsUrl, 'fs', `/file?path=${encodeURIComponent(encodeURIComponent('no-existe.pdf'))}`);
		if (pacsUrl) await revisar('Bridge PACS', pacsUrl, 'pacs', '/studies?patientId=0');
	} catch (e) {
		mal(e.message);
	}
	console.log(fallas ? `\n${fallas} problema(s).` : '\nTodo OK.');
	process.exit(fallas ? 1 : 0);
})();
