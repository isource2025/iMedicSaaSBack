/**
 * Debug usuario 26812159: cuenta MySQL (Railway) vs ficha / sectores / empresa.
 * Uso: node scripts/debug_user_26812159.js [username]
 */
require('dotenv').config();

const USER = String(process.argv[2] || '26812159').trim();

async function main() {
	const mysql = require('mysql2/promise');
	const url = process.env.MYSQL_PUBLIC_URL || '';
	let cfg;
	if (url && url.startsWith('mysql')) {
		cfg = url;
	} else {
		cfg = {
			host: process.env.MYSQL_PUBLIC_HOST || 'zephyr.proxy.rlwy.net',
			port: Number(process.env.MYSQL_PUBLIC_PORT || 56049),
			user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
			password:
				process.env.MYSQLPASSWORD ||
				process.env.MYSQL_ROOT_PASSWORD ||
				'',
			database: process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || 'railway',
		};
	}

	console.log('Conectando MySQL Railway…', typeof cfg === 'string' ? cfg.replace(/:[^:@]+@/, ':***@') : `${cfg.host}:${cfg.port}/${cfg.database}`);
	const p = await mysql.createPool(cfg);

	const section = (t) => console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);

	section(`1. imPassword WHERE NombreRed / Documento / Valor = ${USER}`);
	const [pw] = await p.query(
		`
    SELECT IdEmpresa, ValorPersonal, NombreRed, NumeroDocumento, CodOperador, Grupo,
           LENGTH(Password) AS pwLen, LEFT(Password, 12) AS pwPrefix,
           Apellido, Nombres, MarcadeBaja
    FROM imPassword
    WHERE LOWER(TRIM(COALESCE(NombreRed,''))) = LOWER(?)
       OR TRIM(COALESCE(NumeroDocumento,'')) = ?
       OR CAST(ValorPersonal AS CHAR) = ?
    ORDER BY IdEmpresa, ValorPersonal
  `,
		[USER, USER, USER],
	);
	console.table(pw);
	if (!pw.length) {
		console.log('⚠ No hay filas en imPassword (MySQL). El login no debería funcionar vía AUTH central.');
	}

	section('2. Columnas imPersonal + match Valor / documento');
	const [perCols] = await p.query('SHOW COLUMNS FROM imPersonal');
	console.log(perCols.map((c) => c.Field).join(', '));
	const docCol = perCols.find((c) =>
		/numero|documento|dni|nrodoc/i.test(c.Field),
	)?.Field;
	const [per] = await p.query(
		`
    SELECT *
    FROM imPersonal
    WHERE CAST(Valor AS CHAR) = ?
       ${docCol ? `OR TRIM(COALESCE(CAST(\`${docCol}\` AS CHAR),'')) = ?` : ''}
    ORDER BY IdEmpresa, Valor
    LIMIT 50
  `,
		docCol ? [USER, USER] : [USER],
	);
	console.table(
		per.map((r) => {
			const o = { IdEmpresa: r.IdEmpresa, Valor: r.Valor, Rol: r.Rol };
			if (r.ApellidoNombre != null) o.ApellidoNombre = r.ApellidoNombre;
			if (docCol && r[docCol] != null) o[docCol] = r[docCol];
			return o;
		}),
	);

	const ids = [...new Set(pw.map((r) => Number(r.ValorPersonal)).filter((n) => n > 0))];
	const emps = [...new Set(pw.map((r) => Number(r.IdEmpresa)))];

	if (ids.length) {
		section('3. imPersonalEmpresas (vínculo login)');
		const [pe] = await p.query(
			`SELECT * FROM imPersonalEmpresas WHERE IdPersonal IN (?)`,
			[ids],
		);
		console.table(pe);

		section('4. Ficha imPersonal por ValorPersonal de la cuenta');
		const [perById] = await p.query(
			`SELECT * FROM imPersonal WHERE Valor IN (?)`,
			[ids],
		);
		console.table(
			perById.map((r) => ({
				IdEmpresa: r.IdEmpresa,
				Valor: r.Valor,
				ApellidoNombre: r.ApellidoNombre,
				Rol: r.Rol,
			})),
		);

		section('5. Sectores asignados (imPersonalSectores)');
		try {
			const [ps] = await p.query(
				`
        SELECT ps.IdEmpresa, ps.idPersonal, ps.idSector,
               s.Descripcion AS sectorDesc, s.Codigo AS sectorCodigo
        FROM imPersonalSectores ps
        LEFT JOIN Sectores s ON s.IdSector = ps.idSector AND s.IdEmpresa = ps.IdEmpresa
        WHERE ps.idPersonal IN (?)
      `,
				[ids],
			);
			console.table(ps);
		} catch (e) {
			console.log('fallback sin join Sectores:', e.message);
			const [ps2] = await p.query(
				`SELECT * FROM imPersonalSectores WHERE idPersonal IN (?)`,
				[ids],
			);
			console.table(ps2);
		}

		section('6. Roles (imPersonalRoles)');
		try {
			const [pr] = await p.query(
				`SELECT * FROM imPersonalRoles WHERE Valor IN (?)`,
				[ids],
			);
			console.table(pr);
		} catch (e) {
			console.log(e.message);
		}
	}

	section('7. Empresas (IP / conexión SQL remota)');
	const [cols] = await p.query('SHOW COLUMNS FROM Empresas');
	const fields = cols.map((c) => c.Field);
	console.log('Columnas:', fields.join(', '));
	const interesting = fields.filter((f) =>
		/empresa|desc|activo|server|host|ip|port|puerto|db|sql|user|conn|url|file/i.test(f),
	);
	const [empresas] = await p.query(
		`SELECT ${interesting.map((f) => `\`${f}\``).join(', ')} FROM Empresas ORDER BY IDEMPRESA`,
	);
	for (const r of empresas) {
		const copy = { ...r };
		for (const k of Object.keys(copy)) {
			if (/pass|secret|pwd|clave/i.test(k)) copy[k] = '***';
		}
		console.log(JSON.stringify(copy));
	}

	if (emps.length) {
		section(`8. Detalle empresa(s) del usuario: ${emps.join(',')}`);
		const [det] = await p.query(
			`SELECT * FROM Empresas WHERE IDEMPRESA IN (?)`,
			[emps.filter((e) => e > 0)],
		);
		for (const r of det) {
			const copy = { ...r };
			for (const k of Object.keys(copy)) {
				if (/pass|secret|pwd|clave/i.test(k)) copy[k] = '***';
			}
			console.log(JSON.stringify(copy, null, 2));
		}
	}

	section('9. Diagnóstico rápido');
	if (!pw.length) {
		console.log('- Sin cuenta MySQL → login AUTH no aplica a este user');
	} else {
		for (const row of pw) {
			const hasPe = true;
			const ficha = perByIdSafe(per, row);
			console.log(
				`- Cuenta IdEmpresa=${row.IdEmpresa} ValorPersonal=${row.ValorPersonal} NombreRed=${row.NombreRed} Grupo=${row.Grupo}`,
			);
			if (Number(row.IdEmpresa) === 0) {
				console.log('  → es cuenta de PLATAFORMA (superadmin path)');
			}
			if (!String(row.NombreRed || '').trim()) {
				console.log('  ⚠ NombreRed vacío');
			}
		}
		const peCheck = await p.query(
			`SELECT IdEmpresa, IdPersonal FROM imPersonalEmpresas WHERE IdPersonal IN (?)`,
			[ids],
		);
		const peRows = peCheck[0] || [];
		for (const row of pw) {
			const ok = peRows.some(
				(r) => Number(r.IdPersonal) === Number(row.ValorPersonal) && Number(r.IdEmpresa) === Number(row.IdEmpresa),
			);
			if (!ok && Number(row.IdEmpresa) > 0) {
				console.log(
					`  ⚠ Falta imPersonalEmpresas para ValorPersonal=${row.ValorPersonal} IdEmpresa=${row.IdEmpresa} → login tenant puede fallar o quedar inconsistente`,
				);
			} else if (ok) {
				console.log(
					`  ✓ imPersonalEmpresas OK (${row.ValorPersonal}@emp${row.IdEmpresa})`,
				);
			}
			const fichaNube = await p.query(
				`SELECT Valor FROM imPersonal WHERE IdEmpresa=? AND Valor=? LIMIT 1`,
				[row.IdEmpresa, row.ValorPersonal],
			);
			if (!(fichaNube[0] || []).length && Number(row.IdEmpresa) > 0) {
				console.log(
					`  ⚠ Sin ficha imPersonal en MySQL para ${row.ValorPersonal}@${row.IdEmpresa} (cuenta solo-nube parcial)`,
				);
			}
		}
	}

	await p.end();
}

function perByIdSafe() {
	return null;
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
