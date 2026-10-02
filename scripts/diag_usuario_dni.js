/**
 * Diagnóstico de un usuario concreto: por qué puede loguearse pero no aparece en el panel
 * de administración y no puede cargar indicaciones.
 *
 * Uso: node scripts/diag_usuario_dni.js 26812159
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');

const USUARIO = String(process.argv[2] || '26812159').trim();

function seccion(t) {
	console.log(`\n${'═'.repeat(74)}\n  ${t}\n${'═'.repeat(74)}`);
}

function mostrar(rows) {
	if (!rows || rows.length === 0) {
		console.log('  (sin filas)');
		return;
	}
	console.table(rows);
}

async function safe(pool, sql, inputs = {}) {
	try {
		const req = pool.request();
		for (const [k, v] of Object.entries(inputs)) req.input(k, v);
		const r = await req.query(sql);
		return r.recordset || [];
	} catch (e) {
		console.log(`  ⚠ ${e.message}`);
		return null;
	}
}

async function main() {
	let pool;
	try {
		pool = await connectDB();
		console.log(
			`Conectado a ${process.env.DB_SERVER}:${process.env.DB_PORT}/${process.env.DB_NAME} — usuario a diagnosticar: ${USUARIO}`,
		);

		seccion('1. impassword (lo que usa el LOGIN)');
		const pw = await safe(
			pool,
			`SELECT ValorPersonal, RTRIM(LTRIM(NombreRed)) AS NombreRed, CodOperador,
              Grupo, MarcadeBaja, NumeroDocumento, Legajo
       FROM impassword
       WHERE UPPER(RTRIM(LTRIM(NombreRed))) = UPPER(@user)`,
			{ user: USUARIO },
		);
		mostrar(pw);

		const valorPersonal = pw?.[0]?.ValorPersonal ?? null;
		console.log(`\n  → ValorPersonal resuelto por login: ${valorPersonal ?? '(ninguno)'}`);

		seccion('2. imPersonal (lo que usa el PANEL ADMIN y la ficha profesional)');
		const personalPorValor =
			valorPersonal != null
				? await safe(
						pool,
						`SELECT Valor, RTRIM(LTRIM(ISNULL(Apellido,''))) AS Apellido,
                    RTRIM(LTRIM(ISNULL(Nombre,''))) AS Nombre,
                    Matricula, Rol, NumeroDocumento, MarcadeBaja
             FROM imPersonal WHERE Valor = @vp`,
						{ vp: valorPersonal },
					)
				: null;
		console.log('  Por Valor = ValorPersonal de impassword:');
		mostrar(personalPorValor);

		console.log('\n  Por NumeroDocumento = DNI ingresado:');
		mostrar(
			await safe(
				pool,
				`SELECT Valor, RTRIM(LTRIM(ISNULL(Apellido,''))) AS Apellido,
                RTRIM(LTRIM(ISNULL(Nombre,''))) AS Nombre,
                Matricula, Rol, NumeroDocumento, MarcadeBaja
         FROM imPersonal
         WHERE LTRIM(RTRIM(CONVERT(VARCHAR(30), NumeroDocumento))) = @user`,
				{ user: USUARIO },
			),
		);

		seccion('3. imPersonalEmpresas (vínculo con la empresa / tenant)');
		mostrar(
			valorPersonal != null
				? await safe(
						pool,
						`SELECT pe.IdPersonal, pe.IdEmpresa, RTRIM(LTRIM(ISNULL(e.DESCRIPCION,''))) AS Empresa
             FROM dbo.imPersonalEmpresas pe
             LEFT JOIN dbo.Empresas e ON e.IDEMPRESA = pe.IdEmpresa
             WHERE pe.IdPersonal = @vp`,
						{ vp: valorPersonal },
					)
				: null,
		);

		seccion('4. imPersonalSectores (de dónde sale el sector)');
		mostrar(
			valorPersonal != null
				? await safe(
						pool,
						`SELECT * FROM imPersonalSectores WHERE IdPersonal = @vp`,
						{ vp: valorPersonal },
					)
				: null,
		);

		seccion('5. Rol y permisos');
		mostrar(
			valorPersonal != null
				? await safe(
						pool,
						`SELECT p.Valor, p.Rol AS RolEnPersonal, r.IdRol, r.Nombre AS RolNombre, r.Nivel, r.Activo
             FROM imPersonal p
             LEFT JOIN imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol))
             WHERE p.Valor = @vp`,
						{ vp: valorPersonal },
					)
				: null,
		);

		seccion('6. Réplica exacta del JOIN que hace el login (autenticarEnTenant)');
		mostrar(
			await safe(
				pool,
				`SELECT TOP 1 pw.ValorPersonal, RTRIM(LTRIM(pw.NombreRed)) AS NombreRed,
                p.Valor AS PersonalValor, p.Matricula, p.Rol AS RolPersonal,
                r.IdRol AS RolId, r.Nombre AS RolNombre, r.Nivel AS RolNivel
         FROM impassword pw
         LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
         LEFT JOIN imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
         WHERE UPPER(RTRIM(LTRIM(pw.NombreRed))) = UPPER(RTRIM(LTRIM(@user)))`,
				{ user: USUARIO },
			),
		);

		seccion('7. Empresas del catálogo y su conexión SQL configurada');
		mostrar(
			await safe(
				pool,
				`SELECT IDEMPRESA, RTRIM(LTRIM(ISNULL(DESCRIPCION,''))) AS Empresa
         FROM dbo.Empresas ORDER BY IDEMPRESA`,
			),
		);
	} catch (e) {
		console.error('Error:', e.message);
		process.exitCode = 1;
	} finally {
		try {
			if (pool) await pool.close();
		} catch {
			/* ignore */
		}
		process.exit(process.exitCode ?? 0);
	}
}

main();
