/**
 * Auditoría esquema Bot WhatsApp + tablas Agenda relacionadas.
 * Uso: node scripts/audit_bot_schema.js
 */
require('dotenv').config();
const db = require('../src/models/db');

const TABLAS_BOT = [
	'imBotConfig',
	'imBotChat',
	'imBotConversacion',
	'imBotMensaje',
	'imBotTurnosLog',
];

const TABLAS_AGENDA = [
	'imTurnos',
	'imPersonalHorarios',
	'imPersonalNoHorarios',
	'imFeriados',
	'imPacientes',
	'imPersonal',
];

const COLUMNAS_REQUERIDAS = {
	imBotConfig: ['IdConfig', 'Clave', 'Valor', 'Tipo', 'Activo'],
	imBotChat: [
		'IdRegistro',
		'Tipo',
		'IdSesion',
		'TelefonoWhatsApp',
		'ModoControl',
		'Contenido',
		'Direccion',
		'Origen',
		'FechaRegistro',
	],
	imBotConversacion: [
		'IdConversacion',
		'TelefonoWhatsApp',
		'ModoControl',
		'NoLeidos',
		'Activo',
	],
	imBotMensaje: ['IdMensaje', 'IdConversacion', 'Direccion', 'Origen', 'Contenido'],
	imBotTurnosLog: ['IdLog', 'Accion', 'FechaAccion'],
};

async function auditarTabla(nombre) {
	const out = { nombre, existe: false, columnas: [], filas: null, indices: [], faltantes: [] };
	const cols = await db.executeQuery(
		`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @p0
		 ORDER BY ORDINAL_POSITION`,
		[{ value: nombre, type: 'VarChar' }],
	);
	if (!cols.length) return out;

	out.existe = true;
	out.columnas = cols;

	const req = COLUMNAS_REQUERIDAS[nombre];
	if (req) {
		const have = new Set(cols.map((c) => c.COLUMN_NAME));
		out.faltantes = req.filter((c) => !have.has(c));
	}

	try {
		const cnt = await db.executeQuery(`SELECT COUNT(*) AS total FROM dbo.[${nombre}]`);
		out.filas = Number(cnt[0]?.total ?? 0);
	} catch (e) {
		out.filas = `error: ${e.message}`;
	}

	try {
		out.indices = await db.executeQuery(
			`SELECT i.name AS index_name, i.is_unique, i.is_primary_key,
			        STUFF((SELECT ', ' + c.name
			               FROM sys.index_columns ic
			               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
			               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
			               ORDER BY ic.key_ordinal
			               FOR XML PATH('')), 1, 2, '') AS columnas
			 FROM sys.indexes i
			 WHERE i.object_id = OBJECT_ID(@p0) AND i.type > 0`,
			[{ value: `dbo.${nombre}`, type: 'VarChar' }],
		);
	} catch {
		out.indices = [];
	}

	return out;
}

function printTabla(r) {
	console.log(`\n--- ${r.nombre} ---`);
	if (!r.existe) {
		console.log('  [NO EXISTE]');
		return;
	}
	console.log(`  Filas: ${r.filas}`);
	if (r.faltantes.length) {
		console.log(`  [!] Columnas faltantes vs esquema objetivo: ${r.faltantes.join(', ')}`);
	} else if (COLUMNAS_REQUERIDAS[r.nombre]) {
		console.log('  [OK] Columnas mínimas presentes');
	}
	console.log('  Columnas:');
	r.columnas.forEach((c) => {
		const len = c.CHARACTER_MAXIMUM_LENGTH ? `(${c.CHARACTER_MAXIMUM_LENGTH})` : '';
		console.log(`    ${c.COLUMN_NAME.padEnd(24)} ${c.DATA_TYPE}${len}`);
	});
	if (r.indices.length) {
		console.log('  Índices:');
		r.indices.forEach((i) => {
			const tag = i.is_primary_key ? 'PK' : i.is_unique ? 'UQ' : 'IX';
			console.log(`    ${tag} ${i.index_name} (${i.columnas})`);
		});
	}
}

(async () => {
	try {
		console.log('=== AUDITORÍA BOT + AGENDA ===');
		console.log(`BD: ${process.env.DB_SERVER}/${process.env.DB_NAME}`);

		const todasBot = await db.executeQuery(
			`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
			 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME LIKE 'imBot%'
			 ORDER BY TABLE_NAME`,
		);
		console.log('\nTablas imBot* en BD:', todasBot.map((t) => t.TABLE_NAME).join(', ') || '(ninguna)');

		console.log('\n========== BOT (objetivo mínimo: imBotConfig + imBotChat) ==========');
		for (const t of TABLAS_BOT) {
			printTabla(await auditarTabla(t));
		}

		if (todasBot.some((t) => t.TABLE_NAME === 'imBotConversacion')) {
			const sesiones = await db.executeQuery(
				`SELECT TOP 5 IdConversacion, TelefonoWhatsApp, ModoControl, NoLeidos, PasoBot
				 FROM dbo.imBotConversacion ORDER BY FechaUltimoMensaje DESC`,
			);
			console.log('\nMuestra imBotConversacion:', JSON.stringify(sesiones, null, 2));
		}

		console.log('\n========== AGENDA (existentes — turnera usa estas, sin tablas nuevas) ==========');
		for (const t of TABLAS_AGENDA) {
			printTabla(await auditarTabla(t));
		}

		const conv = await auditarTabla('imBotConversacion');
		const msg = await auditarTabla('imBotMensaje');
		const chat = await auditarTabla('imBotChat');
		const cfg = await auditarTabla('imBotConfig');

		console.log('\n========== RESUMEN ==========');
		const esquemaObjetivo = chat.existe && cfg.existe;
		const esquemaLegacy = conv.existe && msg.existe;
		if (esquemaObjetivo) {
			console.log('[OK] Esquema mínimo (imBotConfig + imBotChat) instalado.');
		} else if (esquemaLegacy) {
			console.log('[LEGACY] imBotConversacion + imBotMensaje — migrar a imBotChat con setup_bot_minimal.sql');
		} else {
			console.log('[PENDIENTE] Ejecutar scripts/sql/setup_bot_minimal.sql');
		}

		if (!cfg.existe) console.log('  - Falta imBotConfig');
		if (!chat.existe && !esquemaLegacy) console.log('  - Falta imBotChat (o par legacy conversacion/mensaje)');

		process.exit(0);
	} catch (e) {
		console.error('Error:', e.message);
		process.exit(1);
	}
})();
