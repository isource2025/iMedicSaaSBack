/**
 * Fotos de productos en el file server de la clínica (túnel files-<clinica>).
 *
 * Se manda `path` relativo (`Productos\<id>-<ts>.jpg`): el file server le antepone
 * su propio root (UncRoot/LocalRoot) y crea la carpeta si no existe, así que no
 * hace falta tocar el script del túnel en cada empresa.
 *
 * En Productos.Foto queda esa ruta relativa. Si el file server no responde y el
 * fallback local está habilitado (dev), se guarda en uploads/productos/<tenant>/
 * con el prefijo `local:`.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const {
	resolveFileServerUrl,
	fileServerHeaders,
	fileServerUploadOk,
	isFileServerUnreachable,
} = require('../utils/fileServerUrl');
const { fileServerFileUrl, formDataFileOptions } = require('../utils/fileNameEncoding');
const { getTenantId } = require('../context/tenantContext');

const CARPETA = String(process.env.PRODUCTOS_FOTOS_CARPETA || 'Productos')
	.replace(/[\\/]+/g, '\\')
	.replace(/^\\+|\\+$/g, '');
const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);
const FALLBACK_LOCAL =
	process.env.FILE_SERVER_FALLBACK_LOCAL === '1' ||
	process.env.ADJUNTOS_LOCAL_FALLBACK === '1' ||
	process.env.NODE_ENV !== 'production';

const PREFIJO_LOCAL = 'local:';
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const FOTOS_LOCAL_DIR = path.join(UPLOADS_DIR, 'productos');
const MIME_POR_EXT = { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const MIME_EXT = { 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/jpg': '.jpg' };

function errorHttp(mensaje, status) {
	const e = new Error(mensaje);
	e.status = status;
	e.statusCode = status;
	return e;
}

/** Ruta absoluta de una foto local; null si apunta fuera de uploads/productos. */
function rutaLocal(ruta) {
	const rel = String(ruta || '');
	if (!rel.startsWith(PREFIJO_LOCAL)) return null;
	const abs = path.resolve(UPLOADS_DIR, rel.slice(PREFIJO_LOCAL.length));
	return abs.startsWith(FOTOS_LOCAL_DIR + path.sep) ? abs : null;
}

/** Solo rutas dentro de la carpeta de fotos: nunca leer/borrar otra cosa del file server. */
function esRutaRemota(ruta) {
	const r = String(ruta || '').replace(/\//g, '\\');
	return r.toLowerCase().startsWith(`${CARPETA.toLowerCase()}\\`) && !r.includes('..');
}

function puedeCaerALocal(err) {
	return FALLBACK_LOCAL && (isFileServerUnreachable(err) || err?.code === 'FILE_SERVER_URL_MISSING');
}

async function guardarLocal(tmp, nombre) {
	const tenant = String(getTenantId() || 0);
	const dir = path.join(FOTOS_LOCAL_DIR, tenant);
	await fs.promises.mkdir(dir, { recursive: true });
	const dest = path.join(dir, nombre);
	await fs.promises.rename(tmp, dest).catch(async () => {
		await fs.promises.copyFile(tmp, dest);
		await fs.promises.unlink(tmp).catch(() => {});
	});
	return `${PREFIJO_LOCAL}productos/${tenant}/${nombre}`;
}

/** Sube el archivo temporal de multer y devuelve la ruta a guardar en Productos.Foto. */
async function subir(idProducto, file) {
	const ext = MIME_EXT[file.mimetype] || '.jpg';
	const nombre = `${idProducto}-${Date.now().toString(36)}${ext}`;
	const relativa = `${CARPETA}\\${nombre}`;
	try {
		const fileServerUrl = await resolveFileServerUrl();
		const form = new FormData();
		form.append('file', fs.createReadStream(file.path), formDataFileOptions(nombre, file.mimetype));
		form.append('path', relativa);
		form.append('nombreArchivo', nombre);
		const resp = await axios.post(`${fileServerUrl}/upload`, form, {
			headers: fileServerHeaders(form.getHeaders()),
			timeout: FILE_SERVER_TIMEOUT_MS,
			maxBodyLength: Infinity,
		});
		if (!fileServerUploadOk(resp.data)) {
			throw new Error(resp.data?.error || 'El servidor de archivos no confirmó la subida');
		}
		await fs.promises.unlink(file.path).catch(() => {});
		return relativa;
	} catch (e) {
		if (puedeCaerALocal(e)) {
			console.warn(`[almacen.fotos] file server no alcanzable (${e.message}); se guarda local`);
			return guardarLocal(file.path, nombre);
		}
		await fs.promises.unlink(file.path).catch(() => {});
		throw e;
	}
}

/** Escribe la imagen en `res`. Devuelve false si no existe. */
async function enviar(ruta, res) {
	const abs = rutaLocal(ruta);
	if (abs) {
		if (!fs.existsSync(abs)) return false;
		res.setHeader('Content-Type', MIME_POR_EXT[path.extname(abs).toLowerCase()] || 'image/jpeg');
		res.setHeader('Cache-Control', 'private, max-age=300');
		fs.createReadStream(abs).pipe(res);
		return true;
	}
	if (!esRutaRemota(ruta)) return false;

	const fileServerUrl = await resolveFileServerUrl();
	const remoto = await axios.get(fileServerFileUrl(fileServerUrl, ruta), {
		headers: fileServerHeaders(),
		responseType: 'stream',
		timeout: FILE_SERVER_TIMEOUT_MS,
		validateStatus: (s) => s >= 200 && s < 500,
	});
	if (remoto.status === 404) {
		remoto.data.resume();
		return false;
	}
	if (remoto.status >= 400) {
		remoto.data.resume();
		throw errorHttp(`El servidor de archivos respondió ${remoto.status}`, 502);
	}
	const tipo = String(remoto.headers['content-type'] || '');
	res.setHeader(
		'Content-Type',
		tipo.startsWith('image/') ? tipo : MIME_POR_EXT[path.extname(ruta).toLowerCase()] || 'image/jpeg',
	);
	res.setHeader('Cache-Control', 'private, max-age=300');
	remoto.data.pipe(res);
	return true;
}

/** Borra la foto; si el file server no responde solo se loguea (el producto ya no la referencia). */
async function borrar(ruta) {
	if (!ruta) return;
	const abs = rutaLocal(ruta);
	if (abs) {
		await fs.promises.unlink(abs).catch(() => {});
		return;
	}
	if (!esRutaRemota(ruta)) return;
	try {
		const fileServerUrl = await resolveFileServerUrl();
		await axios.delete(fileServerFileUrl(fileServerUrl, ruta), {
			headers: fileServerHeaders(),
			timeout: 15000,
			validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
		});
	} catch (e) {
		console.warn(`[almacen.fotos] no se pudo borrar ${ruta}: ${e.message}`);
	}
}

module.exports = { CARPETA, subir, enviar, borrar };
