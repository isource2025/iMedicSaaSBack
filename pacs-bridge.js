/**
 * Bridge HTTP → ClearCanvas ImageServer (Sarmiento / tomógrafo).
 *
 * Corre en la PC del PACS (o en una PC con acceso a SQL + D:\FS) y escucha
 * SOLO en 127.0.0.1. La entrada pública es el túnel Cloudflare:
 *
 *   https://pacs-<clinica>.imedic.com.ar → cloudflared → 127.0.0.1:9013
 *
 * No abre DICOM a Internet: lista estudios por PatientId (SQL) y sirve .dcm
 * desde el filesystem indexado por ImageServer.
 *
 * Variables (scripts/tunnel/pacs.env o entorno del servicio):
 *   IMEDIC_PACS_PORT          default 9013
 *   IMEDIC_PACS_SQL_SERVER    default localhost\\SQLCC
 *   IMEDIC_PACS_SQL_DATABASE  default ImageServer
 *   IMEDIC_PACS_SQL_USER      si vacío → Integrated Security (tedious NTLM no;
 *                             en ese caso usar usuario SQL de solo lectura)
 *   IMEDIC_PACS_SQL_PASSWORD
 *   IMEDIC_PACS_FS_ROOT       default D:\\FS (FilesystemPath de ImageServer)
 *   IMEDIC_PACS_SIGNING_KEY   clave de ESTA clínica para el token firmado (x-imedic-sig)
 *   IMEDIC_PACS_EMPRESA_ID    si está, el token tiene que ser de esta empresa
 *   IMEDIC_PACS_TOKEN         clave compartida legada (x-imedic-token), solo transición
 *
 * Sin IMEDIC_PACS_SIGNING_KEY ni IMEDIC_PACS_TOKEN responde solo /health.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const {
	verifyRequest,
	tokenFromRequest,
	safeEqual,
	MIN_KEY_LENGTH,
	DEFAULT_SKEW_S,
} = require('./src/utils/signedFileToken');

const PORT = Number(process.env.IMEDIC_PACS_PORT || 9013);
const SQL_SERVER = process.env.IMEDIC_PACS_SQL_SERVER || 'localhost\\SQLCC';
const SQL_DATABASE = process.env.IMEDIC_PACS_SQL_DATABASE || 'ImageServer';
const SQL_USER = String(process.env.IMEDIC_PACS_SQL_USER || '').trim();
const SQL_PASSWORD = String(process.env.IMEDIC_PACS_SQL_PASSWORD || '');
const FS_ROOT = process.env.IMEDIC_PACS_FS_ROOT || 'D:\\FS';
const TOKEN = String(process.env.IMEDIC_PACS_TOKEN || '').trim();
const SIGNING_KEY = String(process.env.IMEDIC_PACS_SIGNING_KEY || '').trim();
const EMPRESA_ID = String(process.env.IMEDIC_PACS_EMPRESA_ID || '').trim();
const CLOCK_SKEW_S = Number(process.env.IMEDIC_PACS_CLOCK_SKEW_S || DEFAULT_SKEW_S);
const FIRMA_ACTIVA = SIGNING_KEY.length >= MIN_KEY_LENGTH;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function autenticado(req) {
	const firma = tokenFromRequest(req.headers, req.originalUrl);
	if (firma && FIRMA_ACTIVA) {
		const r = verifyRequest({
			token: firma,
			key: SIGNING_KEY,
			method: req.method,
			url: req.originalUrl,
			skewS: CLOCK_SKEW_S,
			idEmpresaEsperada: EMPRESA_ID,
		});
		if (r.ok) return true;
		console.warn(`[pacs-bridge] firma rechazada (${r.motivo}) ${req.method} ${req.path}`);
	}
	if (!TOKEN) return false;
	const legado = String(req.headers['x-imedic-token'] || req.headers['x-imedic-pacs-key'] || '').trim();
	return safeEqual(legado, TOKEN);
}

app.use((req, res, next) => {
	if (req.path === '/health') return next();
	if (!FIRMA_ACTIVA && !TOKEN) {
		return res.status(503).json({ error: 'bridge sin credenciales: configure IMEDIC_PACS_SIGNING_KEY' });
	}
	if (!autenticado(req)) return res.status(401).json({ error: 'unauthorized' });
	return next();
});

let poolPromise = null;

function sqlConfig() {
	const cfg = {
		server: SQL_SERVER,
		database: SQL_DATABASE,
		options: {
			encrypt: false,
			trustServerCertificate: true,
			enableArithAbort: true,
			instanceName: undefined,
		},
		connectionTimeout: 15000,
		requestTimeout: 60000,
		pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
	};

	// localhost\SQLCC → instanceName SQLCC
	if (SQL_SERVER.includes('\\')) {
		const [host, inst] = SQL_SERVER.split('\\');
		cfg.server = host || 'localhost';
		cfg.options.instanceName = inst;
	}

	if (SQL_USER) {
		cfg.user = SQL_USER;
		cfg.password = SQL_PASSWORD;
	} else {
		// Windows auth vía driver nativo no está en mssql/tedious puro.
		// Forzar error claro si no hay usuario SQL.
		throw new Error(
			'Falta IMEDIC_PACS_SQL_USER. Creá un login SQL de solo lectura en ImageServer ' +
				'(recomendado) o setea usuario/password en pacs.env.',
		);
	}
	return cfg;
}

async function getPool() {
	if (!poolPromise) {
		poolPromise = new sql.ConnectionPool(sqlConfig())
			.connect()
			.catch((err) => {
				poolPromise = null;
				throw err;
			});
	}
	return poolPromise;
}

function normalizePatientId(raw) {
	return String(raw || '')
		.trim()
		.replace(/[.\s-]/g, '');
}

function studyPath(row) {
	return path.join(
		String(row.FilesystemPath || FS_ROOT),
		String(row.PartitionFolder || 'Primary'),
		String(row.StudyFolder || ''),
		String(row.StudyInstanceUid || ''),
	);
}

function safeUnderFs(absPath) {
	const resolved = path.resolve(absPath);
	const root = path.resolve(FS_ROOT);
	const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
	if (resolved !== root && !resolved.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
		return null;
	}
	return resolved;
}

app.get('/health', async (_req, res) => {
	const authed = (FIRMA_ACTIVA || Boolean(TOKEN)) && autenticado(_req);
	const out = {
		ok: true,
		service: 'imedic-pacs-bridge',
		security: 'v1',
		keyConfigured: FIRMA_ACTIVA || Boolean(TOKEN),
		signing: FIRMA_ACTIVA,
		authed,
		epoch: Math.floor(Date.now() / 1000),
		sql: 'unknown',
	};
	if (authed) {
		Object.assign(out, {
			port: PORT,
			sqlServer: SQL_SERVER,
			database: SQL_DATABASE,
			fsRoot: FS_ROOT,
			fsExists: fs.existsSync(FS_ROOT),
		});
	}
	try {
		const pool = await getPool();
		await pool.request().query('SELECT 1 AS ok');
		out.sql = 'ok';
	} catch (e) {
		out.sql = 'fail';
		if (authed) out.sqlError = e.message;
		out.ok = false;
	}
	res.status(out.ok ? 200 : 503).json(out);
});

/** GET /studies?patientId=30123456 */
app.get('/studies', async (req, res) => {
	const patientId = normalizePatientId(req.query.patientId || req.query.PatientID);
	if (!patientId) return res.status(400).json({ error: 'Falta patientId' });

	try {
		const pool = await getPool();
		const r = await pool.request().input('pid', sql.NVarChar(64), patientId).query(`
			SELECT
				st.StudyInstanceUid AS studyInstanceUid,
				st.StudyDate AS studyDate,
				st.StudyTime AS studyTime,
				st.StudyDescription AS studyDescription,
				st.AccessionNumber AS accessionNumber,
				st.PatientId AS patientId,
				st.PatientsName AS patientsName,
				st.PatientsBirthDate AS patientsBirthDate,
				st.PatientsSex AS patientsSex,
				st.NumberOfStudyRelatedSeries AS seriesCount,
				st.NumberOfStudyRelatedInstances AS instanceCount,
				st.StudyStatusEnum AS studyStatusEnum
			FROM dbo.Study st
			WHERE REPLACE(REPLACE(REPLACE(ISNULL(st.PatientId,''), '.', ''), '-', ''), ' ', '') = @pid
			ORDER BY st.StudyDate DESC, st.StudyTime DESC
		`);
		res.json({ patientId, count: r.recordset.length, studies: r.recordset });
	} catch (e) {
		console.error('[pacs-bridge] /studies', e.message);
		res.status(500).json({ error: e.message });
	}
});

/** GET /studies/:uid */
app.get('/studies/:uid', async (req, res) => {
	const uid = String(req.params.uid || '').trim();
	if (!uid) return res.status(400).json({ error: 'Falta StudyInstanceUID' });

	try {
		const pool = await getPool();
		const r = await pool.request().input('uid', sql.NVarChar(128), uid).query(`
			SELECT TOP 1
				st.StudyInstanceUid AS studyInstanceUid,
				st.StudyDate AS studyDate,
				st.StudyTime AS studyTime,
				st.StudyDescription AS studyDescription,
				st.AccessionNumber AS accessionNumber,
				st.PatientId AS patientId,
				st.PatientsName AS patientsName,
				st.NumberOfStudyRelatedSeries AS seriesCount,
				st.NumberOfStudyRelatedInstances AS instanceCount,
				fs.FilesystemPath AS filesystemPath,
				sp.PartitionFolder AS partitionFolder,
				fss.StudyFolder AS studyFolder
			FROM dbo.Study st
			JOIN dbo.ServerPartition sp ON sp.GUID = st.ServerPartitionGUID
			JOIN dbo.StudyStorage ss
				ON ss.ServerPartitionGUID = st.ServerPartitionGUID
				AND ss.StudyInstanceUid = st.StudyInstanceUid
			JOIN dbo.FilesystemStudyStorage fss ON fss.StudyStorageGUID = ss.GUID
			JOIN dbo.Filesystem fs ON fs.GUID = fss.FilesystemGUID
			WHERE st.StudyInstanceUid = @uid
		`);
		if (!r.recordset.length) return res.status(404).json({ error: 'Estudio no encontrado' });
		const row = r.recordset[0];
		const dir = studyPath(row);
		res.json({
			...row,
			path: dir,
			pathExists: fs.existsSync(dir),
		});
	} catch (e) {
		console.error('[pacs-bridge] /studies/:uid', e.message);
		res.status(500).json({ error: e.message });
	}
});

/** GET /studies/:uid/series */
app.get('/studies/:uid/series', async (req, res) => {
	const uid = String(req.params.uid || '').trim();
	try {
		const pool = await getPool();
		const r = await pool.request().input('uid', sql.NVarChar(128), uid).query(`
			SELECT
				SeriesInstanceUid AS seriesInstanceUid,
				SeriesNumber AS seriesNumber,
				Modality AS modality,
				SeriesDescription AS seriesDescription,
				NumberOfSeriesRelatedInstances AS instanceCount,
				SourceApplicationEntityTitle AS sourceAe
			FROM dbo.Series
			WHERE StudyInstanceUid = @uid
			ORDER BY SeriesNumber
		`);
		res.json({ studyInstanceUid: uid, count: r.recordset.length, series: r.recordset });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

/** GET /studies/:uid/files — lista .dcm relativos al estudio */
app.get('/studies/:uid/files', async (req, res) => {
	const uid = String(req.params.uid || '').trim();
	try {
		const pool = await getPool();
		const r = await pool.request().input('uid', sql.NVarChar(128), uid).query(`
			SELECT TOP 1
				fs.FilesystemPath AS FilesystemPath,
				sp.PartitionFolder AS PartitionFolder,
				fss.StudyFolder AS StudyFolder,
				st.StudyInstanceUid AS StudyInstanceUid
			FROM dbo.Study st
			JOIN dbo.ServerPartition sp ON sp.GUID = st.ServerPartitionGUID
			JOIN dbo.StudyStorage ss
				ON ss.ServerPartitionGUID = st.ServerPartitionGUID
				AND ss.StudyInstanceUid = st.StudyInstanceUid
			JOIN dbo.FilesystemStudyStorage fss ON fss.StudyStorageGUID = ss.GUID
			JOIN dbo.Filesystem fs ON fs.GUID = fss.FilesystemGUID
			WHERE st.StudyInstanceUid = @uid
		`);
		if (!r.recordset.length) return res.status(404).json({ error: 'Estudio no encontrado' });
		const dir = safeUnderFs(studyPath(r.recordset[0]));
		if (!dir || !fs.existsSync(dir)) {
			return res.status(404).json({ error: 'Carpeta del estudio no existe en disco', path: dir });
		}

		const files = [];
		const walk = (base, rel = '') => {
			for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
				const relPath = rel ? `${rel}/${ent.name}` : ent.name;
				const abs = path.join(base, ent.name);
				if (ent.isDirectory()) walk(abs, relPath);
				else if (/\.dcm$/i.test(ent.name)) {
					const st = fs.statSync(abs);
					files.push({ path: relPath.replace(/\\/g, '/'), size: st.size });
				}
			}
		};
		walk(dir);
		res.json({ studyInstanceUid: uid, count: files.length, files });
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

/**
 * GET /studies/:uid/file?path=1.2.3/xxx.dcm
 * Sirve un .dcm (para visor / descarga).
 */
app.get('/studies/:uid/file', async (req, res) => {
	const uid = String(req.params.uid || '').trim();
	const rel = String(req.query.path || '').replace(/\\/g, '/');
	if (!rel || rel.includes('..')) return res.status(400).json({ error: 'path inválido' });

	try {
		const pool = await getPool();
		const r = await pool.request().input('uid', sql.NVarChar(128), uid).query(`
			SELECT TOP 1
				fs.FilesystemPath AS FilesystemPath,
				sp.PartitionFolder AS PartitionFolder,
				fss.StudyFolder AS StudyFolder,
				st.StudyInstanceUid AS StudyInstanceUid
			FROM dbo.Study st
			JOIN dbo.ServerPartition sp ON sp.GUID = st.ServerPartitionGUID
			JOIN dbo.StudyStorage ss
				ON ss.ServerPartitionGUID = st.ServerPartitionGUID
				AND ss.StudyInstanceUid = st.StudyInstanceUid
			JOIN dbo.FilesystemStudyStorage fss ON fss.StudyStorageGUID = ss.GUID
			JOIN dbo.Filesystem fs ON fs.GUID = fss.FilesystemGUID
			WHERE st.StudyInstanceUid = @uid
		`);
		if (!r.recordset.length) return res.status(404).json({ error: 'Estudio no encontrado' });
		const dir = safeUnderFs(studyPath(r.recordset[0]));
		if (!dir) return res.status(400).json({ error: 'Ruta fuera de FS_ROOT' });
		const abs = safeUnderFs(path.join(dir, ...rel.split('/')));
		if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
			return res.status(404).json({ error: 'Archivo no encontrado' });
		}
		res.setHeader('Content-Type', 'application/dicom');
		res.setHeader('Content-Disposition', `inline; filename="${path.basename(abs)}"`);
		fs.createReadStream(abs).pipe(res);
	} catch (e) {
		res.status(500).json({ error: e.message });
	}
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, '127.0.0.1', () => {
	console.log(`[pacs-bridge] http://127.0.0.1:${PORT}  sql=${SQL_SERVER}/${SQL_DATABASE}  fs=${FS_ROOT}`);
	const modo = [FIRMA_ACTIVA && 'firma', TOKEN && 'token-legado'].filter(Boolean).join('+');
	console.log(`[pacs-bridge] auth: ${modo || 'SIN CONFIGURAR (solo /health)'}`);
});
