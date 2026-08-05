/**
 * Asegura SUPER_ADMIN de plataforma en MySQL (Railway) si el login está roto o falta.
 * Usado al arranque del backend. No pisa contraseña si el login con SA_PASS ya funciona.
 */
const passwordService = require('./password.service');
const {
	getAuthCentralPool,
	isAuthCentralEnabled,
} = require('../config/authCentralDb');

const NOMBRE_RED = process.env.SA_USER || 'superadmin';
const PASSWORD = process.env.SA_PASS || 'SuperAdmin2026!';
const VALOR_DEFAULT = Number(process.env.SA_VALOR || 1000001);
const ID_ROL_SUPER = 5;
const COLLATE = 'utf8mb4_unicode_ci';

async function puedeLoguearSuperAdmin(pool) {
	const [rows] = await pool.query(
		`
    SELECT pw.*
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p
      ON p.Valor = pw.ValorPersonal AND p.IdEmpresa = pw.IdEmpresa
    LEFT JOIN \`imRoles\` r
      ON CAST(r.IdRol AS CHAR) COLLATE ${COLLATE} = TRIM(COALESCE(p.Rol, '')) COLLATE ${COLLATE}
     AND r.Activo = 1
    WHERE LOWER(TRIM(COALESCE(pw.NombreRed, ''))) COLLATE ${COLLATE} = LOWER(TRIM(?)) COLLATE ${COLLATE}
      AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) COLLATE ${COLLATE} = '5'
        OR COALESCE(pw.Grupo, 0) = 11
      )
    LIMIT 5
    `,
		[NOMBRE_RED],
	);
	if (!rows?.length) return false;
	for (const row of rows) {
		if (await passwordService.verifyPassword(PASSWORD, row)) return true;
	}
	return false;
}

async function asegurarRol(pool) {
	await pool.query(
		`INSERT INTO \`imRoles\` (IdRol, Nombre, Descripcion, Nivel, Activo)
     VALUES (?, 'SUPER_ADMIN', 'Administrador de plataforma (multi-empresa)', 200, 1)
     ON DUPLICATE KEY UPDATE Nombre = VALUES(Nombre), Nivel = VALUES(Nivel), Activo = 1`,
		[ID_ROL_SUPER],
	);
}

async function resolverValor(pool) {
	const [existente] = await pool.query(
		`SELECT ValorPersonal, IdEmpresa FROM \`imPassword\`
     WHERE LOWER(TRIM(NombreRed)) = LOWER(TRIM(?))
     ORDER BY CASE WHEN COALESCE(IdEmpresa, 0) = 0 THEN 0 ELSE 1 END
     LIMIT 1`,
		[NOMBRE_RED],
	);
	if (existente.length) {
		return {
			valor: Number(existente[0].ValorPersonal),
			idEmpresa: Number(existente[0].IdEmpresa) || 0,
			nuevo: false,
		};
	}
	const [maxRow] = await pool.query(
		`SELECT COALESCE(MAX(ValorPersonal), 0) AS maxv FROM \`imPassword\``,
	);
	const maxv = Number(maxRow[0]?.maxv) || 0;
	const valor = maxv >= VALOR_DEFAULT ? maxv + 1 : VALOR_DEFAULT;
	return { valor, idEmpresa: 0, nuevo: true };
}

async function ensureSuperAdmin() {
	if (!isAuthCentralEnabled()) return { skipped: true, reason: 'AUTH_DB off' };

	const pool = await getAuthCentralPool();
	if (await puedeLoguearSuperAdmin(pool)) {
		return { ok: true, repaired: false };
	}

	console.warn(
		`[ensureSuperAdmin] Login de "${NOMBRE_RED}" inválido — reescribiendo cuenta de plataforma…`,
	);

	await asegurarRol(pool).catch((e) =>
		console.warn('[ensureSuperAdmin] rol:', e.message),
	);

	const { valor, idEmpresa } = await resolverValor(pool);
	const emp = Number.isFinite(idEmpresa) ? idEmpresa : 0;
	const hash = await passwordService.hashPassword(PASSWORD);

	// Plataforma: IdEmpresa 0 o el que ya tenía
	await pool.query(
		`
    INSERT INTO \`imPassword\` (IdEmpresa, ValorPersonal, NombreRed, Password, PasswordHash, Grupo, Nombres, Apellido)
    VALUES (?, ?, ?, ?, ?, 11, 'Admin', 'Super')
    ON DUPLICATE KEY UPDATE
      NombreRed = VALUES(NombreRed),
      Password = VALUES(Password),
      PasswordHash = VALUES(PasswordHash),
      Grupo = 11,
      Nombres = COALESCE(Nombres, VALUES(Nombres)),
      Apellido = COALESCE(Apellido, VALUES(Apellido))
    `,
		[emp, valor, NOMBRE_RED, PASSWORD, hash],
	);

	// Si solo existía en empresa tenant, también asegurar fila de plataforma IdEmpresa=0
	if (emp !== 0) {
		await pool.query(
			`
      INSERT INTO \`imPassword\` (IdEmpresa, ValorPersonal, NombreRed, Password, PasswordHash, Grupo, Nombres, Apellido)
      VALUES (0, ?, ?, ?, ?, 11, 'Admin', 'Super')
      ON DUPLICATE KEY UPDATE
        NombreRed = VALUES(NombreRed),
        Password = VALUES(Password),
        PasswordHash = VALUES(PasswordHash),
        Grupo = 11
      `,
			[valor, NOMBRE_RED, PASSWORD, hash],
		);
	}

	await pool.query(
		`
    INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol, Matricula, ApellidoNombre)
    VALUES (?, ?, '5', ?, 'Super, Admin Plataforma')
    ON DUPLICATE KEY UPDATE Rol = '5', ApellidoNombre = VALUES(ApellidoNombre)
    `,
		[emp === 0 ? 0 : emp, valor, valor],
	).catch(async () => {
		// Esquema mínimo
		await pool.query(
			`INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol)
       VALUES (?, ?, '5')
       ON DUPLICATE KEY UPDATE Rol = '5'`,
			[emp === 0 ? 0 : 0, valor],
		);
	});

	// Fila personal también en 0
	await pool
		.query(
			`
    INSERT INTO \`imPersonal\` (IdEmpresa, Valor, Rol, Matricula, ApellidoNombre)
    VALUES (0, ?, '5', ?, 'Super, Admin Plataforma')
    ON DUPLICATE KEY UPDATE Rol = '5'
    `,
			[valor, valor],
		)
		.catch(() => {});

	const ok = await puedeLoguearSuperAdmin(pool);
	console.log(
		`[ensureSuperAdmin] ${ok ? '✓' : '✗'} usuario=${NOMBRE_RED} valor=${valor} idEmpresa=${emp}`,
	);
	return { ok, repaired: true, valor, idEmpresa: emp };
}

module.exports = { ensureSuperAdmin, puedeLoguearSuperAdmin };
