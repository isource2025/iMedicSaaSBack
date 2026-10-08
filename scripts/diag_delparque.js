/**
 * Diagnóstico completo de login on-premise (Del Parque u otra instalación LAN).
 * Correr EN EL SERVIDOR NODE, dentro de la carpeta del backend:
 *
 *   cd ~/app/iMedicSaaSBack
 *   node scripts/diag_delparque.js 36774520            # password = usuario (DNI)
 *   PASS='otra' node scripts/diag_delparque.js 36774520
 *   DOMINIO=https://imedic.cmdelparque.com.ar node scripts/diag_delparque.js 36774520
 *
 * 1. .env del backend y del front (claves enmascaradas).
 * 2. Cuenta del usuario en SQL: impassword, imPersonal, rol, empresa, sectores.
 * 3. Login + /auth/me por cada tramo: API directa, gateway :3000 y dominio (proxy HTTPS).
 * 4. Conclusión: dónde se pierde la sesión y cómo arreglarlo.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const USUARIO = String(process.argv[2] || '').trim();
const PASSWORD = process.env.PASS != null ? String(process.env.PASS) : USUARIO;
const DOMINIO = String(process.env.DOMINIO || 'https://imedic.cmdelparque.com.ar').replace(/\/$/, '');
const API_PORT = Number(process.env.PORT || 5006);
const GW_PORT = Number(process.env.GW_PORT || 3000);

if (!USUARIO) {
	console.error('Uso: node scripts/diag_delparque.js <usuario/DNI>   (PASS=... si la clave no es el DNI)');
	process.exit(1);
}

const hallazgos = [];
const titulo = (t) => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

function enmascarar(clave, valor) {
	if (!/PASS|SECRET|KEY|TOKEN|PWD|ENC/i.test(clave)) return valor;
	if (!valor) return '(vacío)';
	return `${valor.slice(0, 2)}***(${valor.length} chars)`;
}

function mostrarEnv(archivo, filtro) {
	if (!fs.existsSync(archivo)) {
		console.log(`  (no existe) ${archivo}`);
		return {};
	}
	const out = {};
	console.log(`  --- ${archivo}`);
	for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
		const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
		if (!m) continue;
		const [, k, v] = m;
		if (filtro && !filtro.test(k)) continue;
		out[k] = v;
		console.log(`  ${k}=${enmascarar(k, v)}`);
	}
	return out;
}

function decodeJwt(token) {
	try {
		return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
	} catch {
		return null;
	}
}

async function http(metodo, url, { body, bearer } = {}) {
	const headers = { Accept: 'application/json' };
	if (body) headers['Content-Type'] = 'application/json';
	if (bearer) headers.Authorization = `Bearer ${bearer}`;
	try {
		const r = await fetch(url, {
			method: metodo,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			redirect: 'manual',
			signal: AbortSignal.timeout(45000),
		});
		const text = await r.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			/* no json */
		}
		return { status: r.status, json, text, setCookie: r.headers.getSetCookie?.() || [] };
	} catch (e) {
		return { status: 0, error: e.cause?.code || e.message };
	}
}

async function loginCompleto(base) {
	const body = { username: USUARIO, password: PASSWORD };
	let r = await http('POST', `${base}/auth/login`, { body });
	for (let paso = 0; paso < 3 && r.json?.step && r.json?.tempToken; paso++) {
		body.tempToken = r.json.tempToken;
		if (r.json.step === 'SELECT_EMPRESA') {
			body.idEmpresa = r.json.empresas?.[0]?.idEmpresa;
			console.log(`    paso SELECT_EMPRESA -> elijo ${body.idEmpresa} de`, r.json.empresas);
		} else if (r.json.step === 'SELECT_SECTOR') {
			if (r.json.idEmpresa != null) body.idEmpresa = r.json.idEmpresa;
			body.idSector = r.json.sectores?.[0]?.idSector;
			console.log(`    paso SELECT_SECTOR -> elijo ${body.idSector} de`, r.json.sectores);
		}
		r = await http('POST', `${base}/auth/login`, { body });
	}
	return r;
}

async function probarTramo(nombre, base) {
	console.log(`\n>>> ${nombre}: ${base}`);
	const health = await http('GET', `${base}/health`);
	console.log(`  /health -> ${health.status || health.error}`);
	if (!health.status) {
		hallazgos.push(`${nombre}: no responde (${health.error}).`);
		return { nombre, ok: false, alcanzable: false };
	}

	const login = await loginCompleto(base);
	console.log(`  POST /auth/login -> ${login.status || login.error}  ${login.json?.mensaje || ''}`);
	if (login.setCookie.length) console.log('  Set-Cookie:', login.setCookie);
	if (login.status !== 200 || !login.json?.success) {
		console.log('  body:', (login.text || '').slice(0, 400));
		return { nombre, ok: false, alcanzable: true, loginFallo: login.json?.mensaje || login.status };
	}

	const token = login.json.token;
	const payload = token ? decodeJwt(token) : null;
	console.log(`  token en respuesta: ${token ? 'SI' : 'NO'}`);
	if (payload) {
		console.log('  JWT payload:', {
			usuario: payload.usuario,
			rol: payload.rol,
			idEmpresa: payload.idEmpresa,
			idSector: payload.idSector,
			sessionId: payload.sessionId,
			exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
		});
	}
	console.log(`  rol devuelto: ${JSON.stringify(login.json.rol)}  permisos: ${(login.json.permisos || []).length}`);

	if (!token) {
		hallazgos.push(`${nombre}: el login no devolvió token (ni cookie): el front no tiene con qué autenticarse.`);
		return { nombre, ok: false, alcanzable: true };
	}

	const me = await http('GET', `${base}/auth/me`, { bearer: token });
	console.log(`  GET /auth/me (Bearer) -> ${me.status}  ${me.json?.mensaje || (me.json?.success ? 'OK' : '')}`);
	const perm = await http('GET', `${base}/permisos/me`, { bearer: token });
	console.log(`  GET /permisos/me (Bearer) -> ${perm.status}  ${perm.json?.mensaje || (perm.json?.success ? 'OK' : '')}`);
	const sinToken = await http('GET', `${base}/auth/me`);
	console.log(`  GET /auth/me (sin token, referencia) -> ${sinToken.status}  ${sinToken.json?.mensaje || ''}`);

	return { nombre, ok: me.status === 200, alcanzable: true, meStatus: me.status, meMensaje: me.json?.mensaje };
}

async function q(db, titulo, sql, params = []) {
	try {
		const rows = await db.executeQuery(sql, params.map((value) => ({ value })));
		console.log(`\n  [${titulo}]`);
		if (rows.length) console.table(rows);
		else console.log('  (sin filas)');
		return rows;
	} catch (e) {
		console.log(`\n  [${titulo}] ERROR: ${e.message}`);
		return null;
	}
}

(async () => {
	titulo('1. CONFIGURACIÓN (.env)');
	const back = mostrarEnv(path.join(__dirname, '..', '.env'));
	const frontDir = path.join(__dirname, '..', '..', 'iMedicSaaSFront');
	for (const f of ['.env', '.env.local', '.env.production']) {
		mostrarEnv(path.join(frontDir, f), /^NEXT_PUBLIC_/);
	}
	const authCentral = String(back.AUTH_DB_ENABLED || '') === '1' || /true/i.test(back.AUTH_DB_ENABLED || '');
	console.log(
		`\n  Modo de sesión: ${authCentral ? 'AuthCentral MySQL (cookies + AuthSessions)' : 'SQL local, SIN cookies: todo depende del header Authorization: Bearer'}`,
	);
	if (!back.JWT_SECRET) hallazgos.push('.env sin JWT_SECRET: en producción el backend no arranca o usa uno distinto tras reinicios.');

	titulo(`2. CUENTA "${USUARIO}" EN SQL SERVER (${process.env.DB_SERVER}/${process.env.DB_NAME})`);
	const db = require('../src/models/db');
	let pw = null;
	try {
		pw = await db.executeQuery(
			`SELECT * FROM impassword WHERE UPPER(LTRIM(RTRIM(NombreRed))) = UPPER(LTRIM(RTRIM(@p0)))`,
			[{ value: USUARIO }],
		);
		console.log('\n  [impassword]');
		if (pw.length) {
			console.table(
				pw.map((r) => ({
					NombreRed: r.NombreRed ?? r.nombrered,
					ValorPersonal: r.ValorPersonal,
					Grupo: r.Grupo,
					PasswordLegacy: r.Password ?? r.password ? 'TIENE' : 'VACIA',
					PasswordHash: r.PasswordHash ?? r.passwordHash ? 'TIENE' : 'VACIA',
				})),
			);
		} else console.log('  (sin filas)');
	} catch (e) {
		console.log(`\n  [impassword] ERROR: ${e.message}`);
	}
	const vp = pw?.[0]?.ValorPersonal;
	if (!pw?.length) {
		hallazgos.push(`"${USUARIO}" no existe en impassword: no puede loguearse.`);
	} else if (pw.length > 1) {
		hallazgos.push(`"${USUARIO}" está ${pw.length} veces en impassword: el login toma una sola fila (TOP 1).`);
	}
	if (pw?.length && !(Number(vp) > 0)) {
		hallazgos.push(
			`impassword.ValorPersonal de "${USUARIO}" es ${vp}: sin persona vinculada. El login falla o el token sale sin id y /auth/me responde 401.`,
		);
	}

	if (Number(vp) > 0) {
		const per = await q(
			db,
			'imPersonal + imRoles',
			`SELECT p.Valor, p.ApellidoNombre, p.Matricula, p.Rol, r.IdRol, r.Nombre AS RolNombre, r.Activo AS RolActivo
         FROM imPersonal p
         LEFT JOIN imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol))
        WHERE p.Valor = @p0`,
			[vp],
		);
		if (per && !per.length) hallazgos.push(`ValorPersonal ${vp} no existe en imPersonal.`);
		if (per?.[0] && !per[0].RolNombre) {
			hallazgos.push(`imPersonal.Rol="${per[0].Rol}" no matchea un imRoles activo: entra sin rol (solo Mi Perfil).`);
		}
		const emp = await q(
			db,
			'imPersonalEmpresas',
			`SELECT pe.*, e.DESCRIPCION FROM dbo.imPersonalEmpresas pe
         LEFT JOIN dbo.Empresas e ON e.IDEMPRESA = pe.IdEmpresa
        WHERE pe.IdPersonal = @p0`,
			[vp],
		);
		if (emp && !emp.length) {
			hallazgos.push(`ValorPersonal ${vp} no está en imPersonalEmpresas: el login local no lo encuentra ("Usuario o contraseña incorrectos").`);
		}
		await q(
			db,
			'Sectores asignados (imPersonalSectores)',
			`SELECT TOP 20 * FROM imPersonalSectores WHERE IdPersonal = @p0`,
			[vp],
		);
	}
	await q(db, 'Empresas', `SELECT IDEMPRESA, DESCRIPCION FROM dbo.Empresas`);

	titulo('3. LOGIN + /auth/me POR TRAMO');
	const tramos = [
		await probarTramo('API directa', `http://127.0.0.1:${API_PORT}/api`),
		await probarTramo('Gateway', `http://127.0.0.1:${GW_PORT}/api`),
		await probarTramo('Dominio (proxy)', `${DOMINIO}/api`),
	];

	titulo('4. CONCLUSIÓN');
	const [directa, gw, dom] = tramos;
	if (directa.loginFallo) {
		hallazgos.push(`El backend rechaza el login de "${USUARIO}": "${directa.loginFallo}". Revisar la sección 2.`);
	} else if (directa.alcanzable && !directa.ok) {
		hallazgos.push(
			`El backend directo responde /auth/me ${directa.meStatus} "${directa.meMensaje}" con un token recién emitido: problema del backend/cuenta, no del dominio.`,
		);
	} else if (directa.ok && gw.alcanzable && !gw.ok && !gw.loginFallo) {
		hallazgos.push(
			`Directo OK pero el gateway da /auth/me ${gw.meStatus} "${gw.meMensaje}": gateway.js no reenvía el header Authorization.`,
		);
	} else if (directa.ok && (gw.ok || !gw.alcanzable) && dom.alcanzable && !dom.ok && !dom.loginFallo) {
		hallazgos.push(
			`Directo y gateway OK pero por el dominio /auth/me da ${dom.meStatus} "${dom.meMensaje}": el proxy (Nginx Proxy Manager) no reenvía Authorization.`,
		);
	} else if (tramos.every((t) => t.ok)) {
		hallazgos.push(
			'Los 3 tramos funcionan con token fresco. El 401 del navegador viene de un token viejo/vencido en localStorage ' +
				'(con AUTH_DB_ENABLED=0 no hay refresh: vence a las 24 h). Solución: cerrar sesión o borrar datos del sitio y volver a entrar.',
		);
	}
	if (!hallazgos.length) hallazgos.push('Sin hallazgos concluyentes: pasar la salida completa.');
	hallazgos.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
	process.exit(0);
})().catch((e) => {
	console.error('Error inesperado:', e);
	process.exit(1);
});
