#!/usr/bin/env node
/**
 * Clave de firma de UNA clínica para el file server (fs) o el bridge PACS (pacs).
 *
 *   # derivada de la maestra (la misma que tiene Railway en IMEDIC_SIGNING_MASTER):
 *   IMEDIC_SIGNING_MASTER=... node scripts/tunnel/clave-firma.js --servicio fs --empresa 101
 *
 *   # aleatoria (después se carga en FILE_SERVER_SIGNING_KEYS / PACS_SIGNING_KEYS):
 *   node scripts/tunnel/clave-firma.js --servicio fs --empresa 101 --aleatoria
 *
 *   # nueva clave maestra para Railway:
 *   node scripts/tunnel/clave-firma.js --maestra
 *
 * La clave se pega en el instalador de la clínica ($SigningKey / -SigningKey).
 * Es un secreto: no la commitees ni la pegues en un chat.
 */
const crypto = require('crypto');
const { deriveClinicKey } = require('../../src/utils/signedFileToken');

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	if (i < 0) return undefined;
	const v = process.argv[i + 1];
	return v && !v.startsWith('--') ? v : true;
}

function salir(msg) {
	console.error(msg);
	process.exit(1);
}

if (arg('maestra')) {
	console.log(crypto.randomBytes(32).toString('hex'));
	process.exit(0);
}

const servicio = String(arg('servicio') || '');
const empresa = Number(arg('empresa'));
if (!['fs', 'pacs'].includes(servicio)) salir('Falta --servicio fs|pacs');
if (!Number.isInteger(empresa) || empresa <= 0) salir('Falta --empresa <IDEMPRESA>');

if (arg('aleatoria')) {
	const key = crypto.randomBytes(32).toString('hex');
	const envName = servicio === 'fs' ? 'FILE_SERVER_SIGNING_KEYS' : 'PACS_SIGNING_KEYS';
	console.log(key);
	console.error(`Agregar a ${envName} en Railway:  "${empresa}":"${key}"`);
	process.exit(0);
}

const master = String(process.env.IMEDIC_SIGNING_MASTER || '').trim();
if (!master) salir('Falta IMEDIC_SIGNING_MASTER en el entorno (o usar --aleatoria).');
console.log(deriveClinicKey(master, servicio, empresa));
