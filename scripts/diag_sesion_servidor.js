/**
 * Diagnóstico de sesiones en el servidor del cliente (correr en la carpeta del backend desplegado):
 *   node scripts/diag_sesion_servidor.js
 *
 * Revisa: variables que afectan cookies, huella de JWT_SECRET, zona horaria Node vs MySQL
 * y las últimas filas de AuthSessions (si el servidor las consideraría vencidas por inactividad).
 */
require('dotenv').config();
const crypto = require('crypto');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../src/config/authCentralDb');

function fmtOffset(min) {
	const s = min <= 0 ? '+' : '-';
	const a = Math.abs(min);
	return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

(async () => {
	const env = process.env;
	console.log('=== Entorno ===');
	console.table({
		NODE_ENV: env.NODE_ENV || '(vacío)',
		LOCAL_DEV_ONLY: env.LOCAL_DEV_ONLY || '(vacío)',
		AUTH_DB_ENABLED: env.AUTH_DB_ENABLED || '(vacío)',
		COOKIE_SECURE: env.COOKIE_SECURE || '(vacío)',
		COOKIE_SAMESITE: env.COOKIE_SAMESITE || '(vacío)',
		CORS_ORIGINS: env.CORS_ORIGINS || '(vacío)',
		TZ: env.TZ || '(vacío)',
		JWT_SECRET_sha256_8: env.JWT_SECRET
			? crypto.createHash('sha256').update(env.JWT_SECRET).digest('hex').slice(0, 8)
			: '(NO DEFINIDO: usa secreto dev)',
		authCentralEnabled: isAuthCentralEnabled(),
	});

	const secure = env.NODE_ENV === 'production' || env.COOKIE_SECURE === '1';
	console.log(
		`Cookies se emiten con Secure=${secure}. ` +
			(secure ? 'Si el navegador entra por http:// (sin TLS) las descarta.' : ''),
	);

	if (!isAuthCentralEnabled()) {
		console.log('\nAuthCentral deshabilitado: no se crean sesiones ni cookies; el front depende del Bearer.');
		process.exit(0);
	}

	const pool = await getAuthCentralPool();
	const nodeNow = new Date();
	const [[tz]] = await pool.query(
		`SELECT NOW() AS ahora, UTC_TIMESTAMP() AS utc, @@global.time_zone AS global_tz,
            @@session.time_zone AS session_tz, @@system_time_zone AS system_tz`,
	);

	const mysqlNowComoNode = new Date(tz.ahora);
	const desfaseMin = Math.round((nodeNow.getTime() - mysqlNowComoNode.getTime()) / 60000);

	console.log('\n=== Hora Node vs MySQL ===');
	console.table({
		node_local: nodeNow.toString(),
		node_offset: fmtOffset(nodeNow.getTimezoneOffset()),
		mysql_NOW: String(tz.ahora),
		mysql_UTC: String(tz.utc),
		mysql_global_tz: tz.global_tz,
		mysql_session_tz: tz.session_tz,
		mysql_system_tz: tz.system_tz,
		desfase_minutos: desfaseMin,
	});
	if (Math.abs(desfaseMin) >= 2) {
		console.log(
			`\n*** DESFASE: NOW() de MySQL leído por Node difiere ${desfaseMin} min. ` +
				'Con un backend viejo (touchSession con NOW()) ' +
				(desfaseMin > 0
					? 'las sesiones parecen inactivas y se revocan ~30-60 s después del login. '
					: 'las sesiones parecen en el futuro y no vencen por inactividad. ') +
				'La versión actual usa la hora de Node: desplegarla y volver a iniciar sesión.',
		);
	} else {
		console.log('\nOK: Node y MySQL coinciden en hora.');
	}

	let idle = 30;
	try {
		const [r] = await pool.query(
			`SELECT Valor FROM imPlataformaConfig WHERE Clave = 'SESSION_IDLE_MINUTES' LIMIT 1`,
		);
		if (r[0]?.Valor != null) idle = Number(r[0].Valor);
	} catch {
		/* opcional */
	}

	const [rows] = await pool.query(
		`SELECT SessionId, Username, IdEmpresa, LastActivityAt, ExpiresAt, Revoked, CreatedAt, Ip
       FROM AuthSessions ORDER BY CreatedAt DESC LIMIT 10`,
	);
	console.log(`\n=== Últimas sesiones (idle global = ${idle} min; puede variar por empresa) ===`);
	console.table(
		rows.map((s) => {
			const edadMin = Math.round((Date.now() - new Date(s.LastActivityAt).getTime()) / 60000);
			return {
				user: s.Username,
				emp: s.IdEmpresa,
				creada: String(s.CreatedAt),
				lastActivity: String(s.LastActivityAt),
				minDesdeActividad: edadMin,
				revocada: Number(s.Revoked) === 1,
				venceriaPorIdle: edadMin > idle,
			};
		}),
	);

	await pool.end();
})().catch((e) => {
	console.error('Error:', e.message);
	process.exit(1);
});
