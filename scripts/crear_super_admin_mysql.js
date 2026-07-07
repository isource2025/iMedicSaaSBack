#!/usr/bin/env node
/**
 * Crea/actualiza un usuario SUPER_ADMIN de plataforma directamente en MySQL (Railway).
 *
 * El login en producción autentica contra MySQL (authCentral.service.autenticarPlataforma),
 * que compara imPassword.Password en TEXTO PLANO y exige rol SUPER_ADMIN / Rol=5 / Grupo=11.
 * Este script garantiza que ese usuario exista en MySQL (no en SQL Server).
 *
 * Uso (con credenciales de Railway en el .env o vía --env-file):
 *   node scripts/crear_super_admin_mysql.js
 *   node scripts/crear_super_admin_mysql.js --env-file .env.railway.local
 *
 * Variables opcionales:
 *   SA_USER=superadmin
 *   SA_PASS=SuperAdmin2026!
 *   SA_VALOR=1000001        (ValorPersonal; si existe el NombreRed se respeta el suyo)
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const args = process.argv.slice(2);
const envFileIdx = args.indexOf('--env-file');
const envFile =
	envFileIdx >= 0 && args[envFileIdx + 1]
		? path.resolve(process.cwd(), args[envFileIdx + 1])
		: null;

if (envFile) {
	if (!fs.existsSync(envFile)) {
		console.error(`No existe el archivo: ${envFile}`);
		process.exit(1);
	}
	dotenv.config({ path: envFile, override: true });
} else {
	dotenv.config();
}

// Forzar modo Railway para este script
process.env.LOCAL_DEV_ONLY = '0';
if (!process.env.AUTH_DB_ENABLED) process.env.AUTH_DB_ENABLED = '1';

const NOMBRE_RED = process.env.SA_USER || 'superadmin';
const PASSWORD = process.env.SA_PASS || 'SuperAdmin2026!';
const VALOR_DEFAULT = Number(process.env.SA_VALOR || 1000001);
const ID_ROL_SUPER = 5;

const {
	getAuthCentralPool,
	isAuthCentralEnabled,
	validateAuthDbEnv,
} = require('../src/config/authCentralDb');

async function tablaExiste(pool, tabla) {
	const [rows] = await pool.query(
		`SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
		[tabla],
	);
	return rows.length > 0;
}

async function columnasMeta(pool, tabla) {
	const [rows] = await pool.query(
		`SELECT COLUMN_NAME AS col, DATA_TYPE AS tipo, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS def, EXTRA AS extra
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
		[tabla],
	);
	const map = new Map();
	for (const r of rows) {
		map.set(String(r.col), {
			tipo: String(r.tipo).toLowerCase(),
			nullable: String(r.nullable).toUpperCase() === 'YES',
			hasDefault: r.def != null,
			autoInc: String(r.extra || '').toLowerCase().includes('auto_increment'),
		});
	}
	return map;
}

const NUMERIC_TYPES = new Set([
	'int',
	'bigint',
	'smallint',
	'tinyint',
	'mediumint',
	'decimal',
	'numeric',
	'float',
	'double',
]);

const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);

function esNumerica(colMap, col) {
	return NUMERIC_TYPES.has(colMap.get(col)?.tipo);
}

/** Valor por defecto para una columna NOT NULL sin default explícito. */
function valorPorTipo(meta) {
	if (NUMERIC_TYPES.has(meta.tipo)) return 0;
	if (DATE_TYPES.has(meta.tipo)) return meta.tipo === 'date' ? '1900-01-01' : '1900-01-01 00:00:00';
	return '';
}

/** Agrega columnas NOT NULL faltantes (sin default y sin auto_increment) con un valor seguro. */
function completarObligatorias(colMap, campos, valores) {
	const yaPuestas = new Set(campos);
	for (const [col, meta] of colMap.entries()) {
		if (yaPuestas.has(col)) continue;
		if (meta.nullable || meta.hasDefault || meta.autoInc) continue;
		campos.push(col);
		valores.push(valorPorTipo(meta));
	}
}

async function asegurarRol(pool) {
	await pool.query(
		`INSERT INTO \`imRoles\` (IdRol, Nombre, Descripcion, Nivel, Activo)
     VALUES (?, 'SUPER_ADMIN', 'Administrador de plataforma (multi-empresa)', 200, 1)
     ON DUPLICATE KEY UPDATE Nombre = VALUES(Nombre), Nivel = VALUES(Nivel), Activo = 1`,
		[ID_ROL_SUPER],
	);
	console.log('• Rol SUPER_ADMIN (IdRol=5) verificado en imRoles.');
}

async function resolverValorPersonal(pool) {
	const [existente] = await pool.query(
		`SELECT ValorPersonal FROM \`imPassword\`
     WHERE LOWER(TRIM(NombreRed)) = LOWER(TRIM(?)) LIMIT 1`,
		[NOMBRE_RED],
	);
	if (existente.length) return { valor: Number(existente[0].ValorPersonal), nuevo: false };

	const [maxRow] = await pool.query(
		`SELECT COALESCE(MAX(ValorPersonal), 0) AS maxv FROM \`imPassword\``,
	);
	const maxv = Number(maxRow[0].maxv) || 0;
	const valor = maxv >= VALOR_DEFAULT ? maxv + 1 : VALOR_DEFAULT;
	return { valor, nuevo: true };
}

async function upsertPassword(pool, valorPersonal) {
	const cols = await columnasMeta(pool, 'imPassword');
	const campos = ['ValorPersonal', 'NombreRed', 'Password'];
	const valores = [valorPersonal, NOMBRE_RED, PASSWORD];
	if (cols.has('Nombres')) {
		campos.push('Nombres');
		valores.push('Admin');
	}
	if (cols.has('Apellido')) {
		campos.push('Apellido');
		valores.push('Super');
	}
	if (cols.has('CodOperador')) {
		campos.push('CodOperador');
		valores.push(esNumerica(cols, 'CodOperador') ? 999 : 'SA');
	}
	if (cols.has('Grupo')) {
		campos.push('Grupo');
		valores.push(11);
	}
	if (cols.has('NumeroDocumento')) {
		campos.push('NumeroDocumento');
		valores.push(esNumerica(cols, 'NumeroDocumento') ? 90000001 : '90000001');
	}

	completarObligatorias(cols, campos, valores);

	const placeholders = campos.map(() => '?').join(', ');
	const updates = ['NombreRed', 'Password', 'Grupo']
		.filter((c) => cols.has(c))
		.map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
		.join(', ');

	await pool.query(
		`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
		valores,
	);
}

async function upsertPersonal(pool, valorPersonal) {
	if (!(await tablaExiste(pool, 'imPersonal'))) return;
	const cols = await columnasMeta(pool, 'imPersonal');
	const campos = ['Valor'];
	const valores = [valorPersonal];
	if (cols.has('Rol')) {
		campos.push('Rol');
		valores.push(String(ID_ROL_SUPER));
	}
	if (cols.has('Matricula')) {
		campos.push('Matricula');
		valores.push(valorPersonal);
	}
	if (cols.has('ApellidoNombre')) {
		campos.push('ApellidoNombre');
		valores.push('Super, Admin Plataforma');
	}

	completarObligatorias(cols, campos, valores);

	const placeholders = campos.map(() => '?').join(', ');
	const updates = ['Rol']
		.filter((c) => cols.has(c))
		.map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
		.join(', ');

	await pool.query(
		`INSERT INTO \`imPersonal\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${placeholders})
     ${updates ? `ON DUPLICATE KEY UPDATE ${updates}` : ''}`,
		valores,
	);
}

async function verificarLogin(pool, valorPersonal) {
	const COLLATE = 'utf8mb4_unicode_ci';
	const [rows] = await pool.query(
		`
    SELECT pw.NombreRed, r.Nombre AS RolNombre, pw.Grupo, p.Rol
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p ON p.Valor = pw.ValorPersonal
    LEFT JOIN \`imRoles\` r
      ON CAST(r.IdRol AS CHAR) COLLATE ${COLLATE} = TRIM(p.Rol) COLLATE ${COLLATE}
     AND r.Activo = 1
    WHERE pw.ValorPersonal = ?
      AND pw.Password = ?
      AND (
        UPPER(COALESCE(r.Nombre, '')) COLLATE ${COLLATE} = 'SUPER_ADMIN'
        OR TRIM(COALESCE(p.Rol, '')) COLLATE ${COLLATE} = '5'
        OR COALESCE(pw.Grupo, 0) = 11
      )
    LIMIT 1
    `,
		[valorPersonal, PASSWORD],
	);
	return rows[0] || null;
}

(async () => {
	console.log('=== Crear Super Admin en MySQL (Railway) ===\n');

	if (!isAuthCentralEnabled()) {
		const { missing } = validateAuthDbEnv();
		console.error('MySQL no configurado. Faltan:', missing.join(', ') || 'AUTH_DB_*');
		console.error('Tip: node scripts/crear_super_admin_mysql.js --env-file .env.railway.local');
		process.exit(1);
	}

	const pool = await getAuthCentralPool();

	if (!(await tablaExiste(pool, 'imPassword'))) {
		console.error('Falta la tabla imPassword en MySQL. Corré primero: npm run auth:mysql:infra-migrate');
		process.exit(1);
	}
	if (await tablaExiste(pool, 'imRoles')) {
		await asegurarRol(pool);
	} else {
		console.warn('⚠ No existe imRoles en MySQL — el usuario usará Grupo=11 para ser SUPER_ADMIN.');
	}

	const { valor, nuevo } = await resolverValorPersonal(pool);
	await upsertPassword(pool, valor);
	await upsertPersonal(pool, valor);

	const ok = await verificarLogin(pool, valor);

	console.log('\n══════════════════════════════════════════');
	console.log('  Super Admin MySQL (producción)');
	console.log('══════════════════════════════════════════');
	console.log(`  Usuario:     ${NOMBRE_RED}`);
	console.log(`  Contraseña:  ${PASSWORD}`);
	console.log(`  ValorPersonal: ${valor} ${nuevo ? '(nuevo)' : '(existente)'}`);
	console.log(`  Login válido:  ${ok ? '✓ SÍ' : '✗ NO — revisar imRoles/Grupo'}`);
	console.log('══════════════════════════════════════════');
	console.log('\nProbá en el front de producción → /dashboard/super-admin\n');

	await pool.end();
	process.exit(ok ? 0 : 2);
})().catch((e) => {
	console.error('Error:', e.message || e);
	process.exit(1);
});
