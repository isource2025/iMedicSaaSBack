require('dotenv').config();
const mysql = require('mysql2/promise');
const { connectDB } = require('../src/config/database');
const {
	getTenantPool,
	loadEmpresaConnectionRow,
	rowToSqlConfig,
	configCacheKey,
} = require('../src/config/tenantDb');
const { authDbConfig } = require('../src/config/authCentralDb');

const PLATFORM_ONLY_TABLES = ['Empresas', 'imUsuarioEmpresaLogin', 'EmpresasModuloPack', 'imIVA'];
const TENANT_TABLES = [
	'imPassword',
	'imPersonal',
	'imRoles',
	'imPermisos',
	'imRolPermisos',
	'imPersonalEmpresas',
	'imPersonalSectores',
	'imSectores',
];

function q(name) {
	return `\`${String(name).replace(/`/g, '``')}\``;
}

function sqlColumnRef(name) {
	return `[${String(name).replace(/]/g, ']]')}]`;
}

async function createMySqlPool() {
	return mysql.createPool({
		...authDbConfig(),
		multipleStatements: true,
	});
}

async function getSqlServerColumns(pool, table) {
	const result = await pool.request().input('table', table).query(`
    SELECT
      COLUMN_NAME,
      DATA_TYPE,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      DATETIME_PRECISION,
      IS_NULLABLE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table
    ORDER BY ORDINAL_POSITION
  `);
	return result.recordset || [];
}

async function getSqlServerPrimaryKey(pool, table) {
	const result = await pool.request().input('table', table).query(`
    SELECT ku.COLUMN_NAME
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
      ON ku.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
     AND ku.TABLE_SCHEMA = tc.TABLE_SCHEMA
     AND ku.TABLE_NAME = tc.TABLE_NAME
    WHERE tc.TABLE_SCHEMA = 'dbo'
      AND tc.TABLE_NAME = @table
      AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    ORDER BY ku.ORDINAL_POSITION
  `);
	return (result.recordset || []).map((row) => row.COLUMN_NAME);
}

function dedupeCaseInsensitiveColumns(columns, table) {
	const seen = new Set();
	const out = [];
	for (const col of columns) {
		const key = String(col.COLUMN_NAME).toLowerCase();
		if (seen.has(key)) {
			console.warn(`[sync auth] ${table}: columna omitida por choque case-insensitive en MySQL -> ${col.COLUMN_NAME}`);
			continue;
		}
		seen.add(key);
		out.push(col);
	}
	return out;
}

function mysqlTypeForColumn(col) {
	const type = String(col.DATA_TYPE || '').toLowerCase();
	const len = col.CHARACTER_MAXIMUM_LENGTH != null ? Number(col.CHARACTER_MAXIMUM_LENGTH) : null;
	const prec = col.NUMERIC_PRECISION != null ? Number(col.NUMERIC_PRECISION) : null;
	const scale = col.NUMERIC_SCALE != null ? Number(col.NUMERIC_SCALE) : null;

	switch (type) {
		case 'bigint': return 'BIGINT';
		case 'int': return 'INT';
		case 'smallint': return 'SMALLINT';
		case 'tinyint': return 'TINYINT UNSIGNED';
		case 'bit': return 'TINYINT(1)';
		case 'decimal':
		case 'numeric':
			return `DECIMAL(${prec || 18},${scale || 0})`;
		case 'money':
			return 'DECIMAL(19,4)';
		case 'smallmoney':
			return 'DECIMAL(10,4)';
		case 'real':
			return 'FLOAT';
		case 'float':
			return 'DOUBLE';
		case 'date':
			return 'DATE';
		case 'time':
			return 'TIME';
		case 'datetime':
		case 'datetime2':
		case 'smalldatetime':
		case 'datetimeoffset':
			return 'DATETIME';
		case 'char':
		case 'nchar':
			if (len == null || len < 1) return 'CHAR(1)';
			return `CHAR(${Math.min(len, 255)})`;
		case 'varchar':
		case 'nvarchar':
			if (len == null) return 'TEXT';
			if (len === -1) return 'LONGTEXT';
			if (len > 1000) return 'TEXT';
			return `VARCHAR(${Math.max(1, len)})`;
		case 'text':
		case 'ntext':
		case 'xml':
			return 'LONGTEXT';
		case 'binary':
		case 'varbinary':
		case 'image':
		case 'timestamp':
		case 'rowversion':
			return 'LONGBLOB';
		case 'uniqueidentifier':
			return 'CHAR(36)';
		default:
			return 'LONGTEXT';
	}
}

async function getMySqlColumns(mysqlPool, table) {
	const [rows] = await mysqlPool.query(
		`
    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `,
		[table],
	);
	return rows || [];
}

function normalizeMySqlType(type) {
	return String(type || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function getMySqlPrimaryKey(mysqlPool, table) {
	const [rows] = await mysqlPool.query(
		`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND CONSTRAINT_NAME = 'PRIMARY'
    ORDER BY ORDINAL_POSITION
    `,
		[table],
	);
	return (rows || []).map((row) => row.COLUMN_NAME);
}

async function ensureTableSchema(mysqlPool, table, columns, pkColumns) {
	const existing = await getMySqlColumns(mysqlPool, table);
	const existingMap = new Map(existing.map((row) => [String(row.COLUMN_NAME).toLowerCase(), row]));

	if (!existing.length) {
		const defs = columns.map((col) =>
			`${q(col.COLUMN_NAME)} ${mysqlTypeForColumn(col)} ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`,
		);
		if (pkColumns.length) {
			defs.push(`PRIMARY KEY (${pkColumns.map((c) => q(c)).join(', ')})`);
		}
		await mysqlPool.query(`CREATE TABLE IF NOT EXISTS ${q(table)} (\n  ${defs.join(',\n  ')}\n)`);
		return;
	}

	const mysqlPk = await getMySqlPrimaryKey(mysqlPool, table);
	const pkChanged =
		mysqlPk.length !== pkColumns.length ||
		mysqlPk.some((col, idx) => String(col).toLowerCase() !== String(pkColumns[idx] || '').toLowerCase());

	if (pkChanged && mysqlPk.length) {
		await mysqlPool.query(`ALTER TABLE ${q(table)} DROP PRIMARY KEY`);
	}

	for (const col of columns) {
		const key = String(col.COLUMN_NAME).toLowerCase();
		const existingCol = existingMap.get(key);
		const targetType = mysqlTypeForColumn(col);
		const isPk = pkColumns.some((pk) => String(pk).toLowerCase() === key);
		const targetNullable = isPk ? 'NO' : col.IS_NULLABLE === 'NO' ? 'NO' : 'YES';

		if (!existingCol) {
			await mysqlPool.query(
				`ALTER TABLE ${q(table)} ADD COLUMN ${q(col.COLUMN_NAME)} ${targetType} ${isPk ? 'NOT NULL' : 'NULL'}`,
			);
			continue;
		}

		const currentType = normalizeMySqlType(existingCol.COLUMN_TYPE);
		const desiredType = normalizeMySqlType(targetType);
		const currentNullable = String(existingCol.IS_NULLABLE || '').toUpperCase();
		if (currentType !== desiredType || (isPk && currentNullable !== 'NO')) {
			await mysqlPool.query(
				`ALTER TABLE ${q(table)} MODIFY COLUMN ${q(col.COLUMN_NAME)} ${targetType} ${isPk ? 'NOT NULL' : currentNullable === 'NO' ? 'NOT NULL' : 'NULL'}`,
			);
		}
	}

	if (pkColumns.length && (pkChanged || !mysqlPk.length)) {
		await mysqlPool.query(`ALTER TABLE ${q(table)} ADD PRIMARY KEY (${pkColumns.map((c) => q(c)).join(', ')})`);
	}
}

async function leerFilas(pool, table, columns) {
	const refs = columns.map((col) => sqlColumnRef(col.COLUMN_NAME)).join(', ');
	const result = await pool.request().query(`SELECT ${refs} FROM dbo.${table}`);
	return result.recordset || [];
}

async function upsertRows(mysqlPool, table, columns, pkColumns, rows, batchSize = 200) {
	if (!rows.length) return 0;
	const names = columns.map((col) => col.COLUMN_NAME);
	const pkSet = new Set(pkColumns.map((c) => String(c).toLowerCase()));
	const nonPk = names.filter((name) => !pkSet.has(String(name).toLowerCase()));
	const updateSql = nonPk.length
		? ` ON DUPLICATE KEY UPDATE ${nonPk.map((name) => `${q(name)} = VALUES(${q(name)})`).join(', ')}`
		: pkColumns.length
			? ` ON DUPLICATE KEY UPDATE ${q(pkColumns[0])} = ${q(pkColumns[0])}`
			: '';
	const hasBinaryPayload = columns.some((col) =>
		['image', 'binary', 'varbinary', 'timestamp', 'rowversion'].includes(
			String(col.DATA_TYPE || '').toLowerCase(),
		),
	);
	const effectiveBatchSize = hasBinaryPayload ? 1 : batchSize;

	for (let i = 0; i < rows.length; i += effectiveBatchSize) {
		const chunk = rows.slice(i, i + effectiveBatchSize);
		const placeholders = chunk
			.map(() => `(${names.map(() => '?').join(', ')})`)
			.join(', ');
		const values = [];
		for (const row of chunk) {
			for (const name of names) {
				values.push(row[name] === undefined ? null : row[name]);
			}
		}
		await mysqlPool.query(
			`INSERT INTO ${q(table)} (${names.map((name) => q(name)).join(', ')}) VALUES ${placeholders}${updateSql}`,
			values,
		);
	}
	return rows.length;
}

function dedupeRowsByPrimaryKey(rows, pkColumns) {
	if (!pkColumns.length) return rows;
	const seen = new Set();
	const out = [];
	for (const row of rows) {
		const key = pkColumns.map((col) => JSON.stringify(row[col] ?? null)).join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(row);
	}
	return out;
}

async function syncOneTable(mysqlPool, source, table) {
	const rawColumns = await getSqlServerColumns(source.pool, table);
	if (!rawColumns.length) {
		console.log(`• ${source.label}/${table}: tabla no encontrada`);
		return 0;
	}

	const columns = dedupeCaseInsensitiveColumns(rawColumns, table);
	const pkColumnsRaw = await getSqlServerPrimaryKey(source.pool, table);
	const existingColumnsLower = new Set(columns.map((col) => String(col.COLUMN_NAME).toLowerCase()));
	const pkColumns = pkColumnsRaw.filter((col) => existingColumnsLower.has(String(col).toLowerCase()));

	await ensureTableSchema(mysqlPool, table, columns, pkColumns);
	const rowsRaw = await leerFilas(source.pool, table, columns);
	const rows = dedupeRowsByPrimaryKey(rowsRaw, pkColumns);
	const copied = await upsertRows(mysqlPool, table, columns, pkColumns, rows);
	const dupes = rowsRaw.length - rows.length;
	console.log(`• ${source.label}/${table}: ${copied} filas${dupes > 0 ? ` (${dupes} duplicadas omitidas)` : ''}`);
	return copied;
}

async function listarEmpresas(pool) {
	const result = await pool.request().query(`SELECT IDEMPRESA FROM dbo.Empresas ORDER BY IDEMPRESA`);
	return result.recordset || [];
}

async function resolveTenantSources(platformPool) {
	const empresas = await listarEmpresas(platformPool);
	const sources = [{ label: 'plataforma', pool: platformPool, key: 'platform' }];
	const seen = new Set(['platform']);

	for (const empresa of empresas) {
		const idEmpresa = Number(empresa.IDEMPRESA);
		const row = await loadEmpresaConnectionRow(idEmpresa);
		const key = configCacheKey(rowToSqlConfig(row));
		if (seen.has(key)) continue;
		seen.add(key);
		sources.push({
			label: `tenant ${idEmpresa}`,
			pool: await getTenantPool(idEmpresa),
			key,
		});
	}

	return sources;
}

async function getMySqlCounts(mysqlPool, tables) {
	const out = {};
	for (const table of tables) {
		try {
			const [rows] = await mysqlPool.query(`SELECT COUNT(*) AS c FROM ${q(table)}`);
			out[table] = Number(rows[0]?.c || 0);
		} catch {
			out[table] = null;
		}
	}
	return out;
}

(async () => {
	console.log('=== Sync login/persona -> Auth central MySQL ===\n');

	if (!process.env.AUTH_DB_HOST || !process.env.AUTH_DB_USER || !process.env.AUTH_DB_NAME) {
		console.error('Faltan AUTH_DB_HOST / AUTH_DB_USER / AUTH_DB_NAME en .env');
		process.exit(1);
	}

	const platformPool = await connectDB();
	const mysqlPool = await createMySqlPool();

	console.log('• Modo merge: no se borran datos existentes en Railway.');
	console.log('• Auditando origen SQL Server y sincronizando esquema real…');

	await syncOneTable(mysqlPool, { label: 'plataforma', pool: platformPool }, 'Empresas');
	await syncOneTable(mysqlPool, { label: 'plataforma', pool: platformPool }, 'imIVA');
	await syncOneTable(mysqlPool, { label: 'plataforma', pool: platformPool }, 'imUsuarioEmpresaLogin');
	await syncOneTable(mysqlPool, { label: 'plataforma', pool: platformPool }, 'EmpresasModuloPack');

	const tenantSources = await resolveTenantSources(platformPool);
	for (const source of tenantSources) {
		for (const table of TENANT_TABLES) {
			await syncOneTable(mysqlPool, source, table);
		}
	}

	const counts = await getMySqlCounts(mysqlPool, [
		'Empresas',
		'imPassword',
		'imPersonal',
		'imPersonalEmpresas',
		'imPersonalSectores',
		'imSectores',
		'imRoles',
		'imPermisos',
		'imRolPermisos',
		'imUsuarioEmpresaLogin',
		'EmpresasModuloPack',
	]);

	console.log('\n=== Totales destino Railway ===');
	for (const [table, count] of Object.entries(counts)) {
		console.log(`• ${table}: ${count == null ? 'N/D' : count}`);
	}

	console.log('\n=== Sync finalizado ===');
	process.exit(0);
})().catch((err) => {
	console.error('Error en sync login auth:', err);
	process.exit(1);
});
