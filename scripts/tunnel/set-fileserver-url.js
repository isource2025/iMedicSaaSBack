/**
 * Guarda FileServerUrl de una empresa vía API Super Admin (Railway).
 *
 *   node scripts/tunnel/set-fileserver-url.js --id 101 --url https://xxxx.trycloudflare.com
 *
 * Login: SA_USER / SA_PASS (default superadmin) y API_URL.
 */
const axios = require('axios');

const arg = (name, def) => {
	const i = process.argv.indexOf(`--${name}`);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return def;
};

const API = String(arg('api', process.env.API_URL || 'https://imedicsaasback-production.up.railway.app/api')).replace(
	/\/+$/,
	'',
);
const URL = String(arg('url', '')).trim().replace(/\/+$/, '');
const ID = Number(arg('id', process.env.SARMIENTO_EMPRESA_ID || 101));
const USER = process.env.SA_USER || 'superadmin';
const PASS = process.env.SA_PASS || 'SuperAdmin2026!';
const MATCH = String(arg('match', 'sarmiento')).toLowerCase();

if (!URL) {
	console.error('Falta --url');
	process.exit(1);
}

async function login() {
	const first = await axios.post(
		`${API}/auth/login`,
		{ username: USER, password: PASS },
		{ timeout: 30000, validateStatus: () => true },
	);
	if (first.status >= 400) {
		throw new Error(`Login HTTP ${first.status}: ${JSON.stringify(first.data)}`);
	}
	if (first.data?.token) return first.data.token;
	if (first.data?.step === 'SELECT_EMPRESA') {
		const empresas = first.data.empresas || [];
		const pick =
			empresas.find((e) => Number(e.idEmpresa || e.id) === ID) ||
			empresas.find((e) => String(e.descripcion || e.nombre || '').toLowerCase().includes(MATCH)) ||
			empresas[0];
		if (!pick) throw new Error('Login pidió empresa y no hay opciones');
		const idEmp = pick.idEmpresa ?? pick.id;
		const second = await axios.post(
			`${API}/auth/login`,
			{ username: USER, password: PASS, idEmpresa: idEmp, tempToken: first.data.tempToken },
			{ timeout: 30000, validateStatus: () => true },
		);
		if (!second.data?.token) {
			throw new Error(`Login empresa HTTP ${second.status}: ${JSON.stringify(second.data)}`);
		}
		return second.data.token;
	}
	throw new Error(`Login sin token: ${JSON.stringify(first.data)}`);
}

(async () => {
	const token = await login();
	const auth = { Authorization: `Bearer ${token}` };

	const list = await axios.get(`${API}/super-admin/empresas`, {
		headers: auth,
		timeout: 30000,
		validateStatus: () => true,
	});
	if (list.status >= 400) {
		throw new Error(`Listar empresas HTTP ${list.status}: ${JSON.stringify(list.data)}`);
	}
	const empresas = list.data?.data || list.data || [];
	const found = (Array.isArray(empresas) ? empresas : []).find((e) => {
		const id = Number(e.id || e.IDEMPRESA);
		const desc = String(e.descripcion || e.DESCRIPCION || '').toLowerCase();
		return id === ID || desc.includes(MATCH);
	});
	if (!found) {
		console.log(
			'Empresas:',
			(Array.isArray(empresas) ? empresas : []).map((e) => ({
				id: e.id || e.IDEMPRESA,
				descripcion: e.descripcion || e.DESCRIPCION,
				fileServerUrl: e.conexion?.fileServerUrl,
			})),
		);
		throw new Error(`No encontré empresa id=${ID} ni nombre con "${MATCH}"`);
	}
	const id = found.id || found.IDEMPRESA;
	console.log(`Empresa: ${id} — ${found.descripcion || found.DESCRIPCION}`);
	console.log(`FileServerUrl anterior: ${found.conexion?.fileServerUrl || '(vacío)'}`);

	const put = await axios.put(
		`${API}/super-admin/empresas/${id}/conexion`,
		{ fileServerUrl: URL },
		{ headers: auth, timeout: 30000, validateStatus: () => true },
	);
	if (put.status >= 400) {
		throw new Error(`PUT conexion HTTP ${put.status}: ${JSON.stringify(put.data)}`);
	}
	const saved = put.data?.data?.conexion?.fileServerUrl || put.data?.data?.FileServerUrl;
	console.log(`FileServerUrl nuevo: ${saved || URL}`);
	console.log('OK');
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
