/**
 * Prueba que TODAS las cuentas de impassword puedan iniciar sesión, usando el flujo real del
 * backend (descubrimiento de empresa, selección de fila, empresa, sector, rol, permisos, token)
 * y el middleware real de /auth/me. No necesita las claves: sólo omite la comparación de la
 * contraseña y verifica que la cuenta tenga una cargada y que no la tape otra fila.
 *
 * Sólo para instalaciones con AUTH_DB_ENABLED=0: no crea sesiones ni toca cuentas (lo único que
 * puede escribir es la carga de feriados que dispara cualquier login).
 *
 *   node scripts/test_login_cuentas.js            # todas
 *   node scripts/test_login_cuentas.js 30216938   # una
 */
require('dotenv').config();
const db = require('../src/models/db');
const { isAuthCentralEnabled } = require('../src/config/authCentralDb');
const tenantRegistry = require('../src/services/tenantRegistry.service');
const { getTenantPool } = require('../src/config/tenantDb');
const { completarLogin } = require('../src/services/authLoginFlow.service');
const { requireAuth } = require('../src/middlewares/authJwt.middleware');
const { runWithTenant } = require('../src/context/tenantContext');

const SOLO = process.argv[2] ? String(process.argv[2]).trim().toUpperCase() : null;

const fakeRes = () => ({
	code: 200,
	body: null,
	req: { headers: {} },
	cookie() {},
	clearCookie() {},
	status(c) {
		this.code = c;
		return this;
	},
	json(b) {
		this.body = b;
		return this;
	},
});

/** Misma consulta que el login (autenticarEnTenant), con las filas vinculadas primero. */
async function filasLogin(idEmpresa, usuario) {
	const pool = await getTenantPool(idEmpresa);
	const r = await pool.request().input('user', usuario).query(`
      SELECT pw.*, p.Matricula AS Matricula, r.IdRol AS RolId, r.Nombre AS RolNombre, r.Nivel AS RolNivel
        FROM impassword pw
        LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
        LEFT JOIN imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
       WHERE UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@user)))
       ORDER BY CASE WHEN ISNULL(pw.ValorPersonal, 0) > 0 THEN 0 ELSE 1 END,
                CASE WHEN p.Valor IS NOT NULL THEN 0 ELSE 1 END`);
	return r.recordset || [];
}

const claveLegacy = (r) => String(r.Password ?? r.password ?? '').trim().toUpperCase();
const tieneClave = (r) => !!claveLegacy(r) || String(r.PasswordHash ?? '').startsWith('$argon2');

async function probarMe(token) {
	const res = fakeRes();
	let ok = false;
	await requireAuth({ headers: { authorization: `Bearer ${token}` }, cookies: {} }, res, () => {
		ok = true;
	});
	return ok ? { ok: true } : { ok: false, mensaje: res.body?.mensaje || `HTTP ${res.code}` };
}

async function simularLogin(usuario, fila, idEmpresa) {
	const base = { res: fakeRes(), username: usuario, idEmpresaSesion: idEmpresa, idEmpresaBody: idEmpresa, ip: 'test', userAgent: 'test_login_cuentas' };
	const correr = (idSectorBody) =>
		runWithTenant(idEmpresa, () => completarLogin({ ...base, usuario: { ...fila }, idSectorBody }));
	try {
		return { payload: await correr(undefined) };
	} catch (e) {
		if (e.message === 'MULTI_SECTOR' && e.sectores?.length) {
			return { payload: await correr(e.sectores[0].idSector), multiSector: e.sectores.length };
		}
		throw e;
	}
}

(async () => {
	if (isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED está activo: este test es sólo para instalaciones con login contra SQL local.');
		process.exit(1);
	}
	console.log(`BD: ${process.env.DB_SERVER}/${process.env.DB_NAME}`);

	const nombres = (
		await db.executeQuery(
			`SELECT DISTINCT UPPER(LTRIM(RTRIM(NombreRed))) AS u FROM impassword WHERE LTRIM(RTRIM(ISNULL(NombreRed,''))) <> '' ORDER BY 1`,
		)
	)
		.map((r) => r.u)
		.filter((u) => !SOLO || u === SOLO);

	const resultados = [];
	for (const usuario of nombres) {
		let candidatos = [];
		try {
			candidatos = await tenantRegistry.descubrirEmpresasPorUsuario(usuario);
		} catch (e) {
			resultados.push({ usuario, vp: '', persona: '', resultado: 'NO ENTRA', detalle: `error buscando empresa: ${e.message}` });
			continue;
		}
		if (!candidatos.length) {
			const filas = await db.executeQuery(
				`SELECT ValorPersonal FROM impassword WHERE UPPER(LTRIM(RTRIM(NombreRed))) = @p0`,
				[{ value: usuario }],
			);
			for (const f of filas) {
				resultados.push({ usuario, vp: f.ValorPersonal ?? 'NULL', persona: '', resultado: 'NO ENTRA', detalle: 'sin empresa (imPersonalEmpresas) o sin ficha' });
			}
			continue;
		}
		const idEmpresa = Number(candidatos[0].idEmpresa);
		const filas = await filasLogin(idEmpresa, usuario);

		for (let i = 0; i < filas.length; i++) {
			const fila = filas[i];
			const vp = fila.ValorPersonal;
			const r = { usuario, vp: vp ?? 'NULL', persona: '', resultado: '', detalle: '' };
			resultados.push(r);

			const previa = filas.slice(0, i).find((p) => claveLegacy(p) && claveLegacy(p) === claveLegacy(fila));
			if (previa && Number(previa.ValorPersonal) === Number(vp)) {
				r.resultado = 'OK';
				r.detalle = 'fila duplicada de la misma persona (sin impacto)';
				continue;
			}
			if (previa) {
				r.resultado = 'NO ENTRA';
				r.detalle = `misma clave que la fila de ValorPersonal ${previa.ValorPersonal}: entra como esa persona. Renombrar usuario`;
				continue;
			}
			if (!tieneClave(fila)) {
				r.resultado = 'NO ENTRA';
				r.detalle = 'sin contraseña cargada';
				continue;
			}
			if (!(Number(vp) > 0)) {
				r.resultado = 'NO ENTRA';
				r.detalle = 'cuenta sin ficha (ValorPersonal 0/NULL): correr normalizar_cuentas_clarion.js';
				continue;
			}
			try {
				const { payload, multiSector } = await simularLogin(usuario, fila, idEmpresa);
				r.persona = [payload.usuario?.apellido, payload.usuario?.nombre].filter(Boolean).join(' ');
				const me = await probarMe(payload.token);
				if (!me.ok) {
					r.resultado = 'NO ENTRA';
					r.detalle = `login OK pero /auth/me: ${me.mensaje}`;
					continue;
				}
				const avisos = [];
				if (!payload.rol?.nombre) avisos.push('sin rol: sólo ve Mi Perfil');
				if (!(payload.permisos || []).length) avisos.push('0 permisos');
				if (candidatos.length > 1) avisos.push(`elige empresa (${candidatos.length})`);
				if (multiSector) avisos.push(`elige sector (${multiSector})`);
				const filasMismoNombre = filas.filter((x) => Number(x.ValorPersonal) > 0 && Number(x.ValorPersonal) !== Number(vp));
				if (filasMismoNombre.length) avisos.push('usuario compartido con otra persona: rol/sector pueden mezclarse. Renombrar');
				const clavesDistintas = new Set(filas.map(claveLegacy).filter(Boolean));
				if (clavesDistintas.size > 1) {
					avisos.push('varias filas con claves distintas: el backend sin actualizar prueba una sola y puede rechazar la clave');
				}
				r.resultado = avisos.length ? 'ENTRA CON AVISOS' : 'OK';
				r.detalle = [`rol ${payload.rol?.nombre || '-'}`, ...avisos].join(' | ');
			} catch (e) {
				r.resultado = 'NO ENTRA';
				r.detalle = e.message;
			}
		}
	}

	console.table(resultados);
	const cuenta = (k) => resultados.filter((r) => r.resultado === k).length;
	console.log(
		`\nTotal ${resultados.length}:  OK ${cuenta('OK')}  |  ENTRA CON AVISOS ${cuenta('ENTRA CON AVISOS')}  |  NO ENTRA ${cuenta('NO ENTRA')}`,
	);
	if (cuenta('NO ENTRA')) {
		console.log('\nPara corregir: node scripts/normalizar_cuentas_clarion.js (plan) y luego --apply');
	}
	process.exit(cuenta('NO ENTRA') ? 1 : 0);
})().catch((e) => {
	console.error('Error:', e);
	process.exit(1);
});
