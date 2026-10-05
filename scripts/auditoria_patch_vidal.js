/**
 * Auditoría Patch / PatchServidor en SQL de Vidal (empresa 1).
 * Solo lectura.
 *
 *   node scripts/auditoria_patch_vidal.js
 *   node scripts/auditoria_patch_vidal.js --empresa 1
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const EMPRESA = Number(
	(() => {
		const i = process.argv.indexOf('--empresa');
		return i >= 0 ? process.argv[i + 1] : 1;
	})(),
);

function bucket(colSql) {
	return `
    CASE
      WHEN ${colSql} IS NULL OR LTRIM(RTRIM(${colSql})) = '' THEN 'VACIO'
      WHEN ${colSql} LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR ${colSql} LIKE '\\\\server\\Imagenes\\Vidal\\%' THEN 'UNC_SERVER_VIDAL'
      WHEN ${colSql} LIKE '\\\\192.%\\Imagenes\\%' THEN 'UNC_IP'
      WHEN ${colSql} LIKE '\\\\%\\Imagenes\\%' THEN 'UNC_OTRO_HOST'
      WHEN ${colSql} LIKE 'E:\\imagenes\\vidal\\%'
        OR ${colSql} LIKE 'E:\\Imagenes\\Vidal\\%' THEN 'E_IMAGENES_VIDAL'
      WHEN ${colSql} LIKE 'E:\\adjuntos\\%' THEN 'E_ADJUNTOS'
      WHEN ${colSql} LIKE '[A-Z]:\\%' THEN 'OTRA_UNIDAD'
      ELSE 'OTRO'
    END
  `;
}

(async () => {
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [er] = await mp.query('SELECT * FROM Empresas WHERE IDEMPRESA=?', [EMPRESA]);
	if (!er[0]) throw new Error(`Empresa ${EMPRESA} no existe`);
	const emp = normalizeEmpresaRow(er[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	const pool = await sql.connect({
		server: String(emp.DbServer).trim(),
		port: Number(emp.DbPort) || 1433,
		database: String(emp.DbName).trim(),
		user: String(emp.DbUser).trim(),
		password,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 120000,
	});

	const q = async (t) => (await pool.request().query(t)).recordset;

	const meta = {
		empresaId: EMPRESA,
		empresaNombre: emp.DESCRIPCION || String(EMPRESA),
		dbHost: String(emp.DbServer).trim(),
		dbName: String(emp.DbName).trim(),
		auditAt: new Date().toISOString(),
	};

	const totals = await q(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN Fecha >= DATEADD(HOUR, -24, GETDATE()) THEN 1 ELSE 0 END) AS ultimas24h,
      SUM(CASE WHEN Fecha >= DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END) AS ultimos7d,
      SUM(CASE WHEN Fecha >= DATEADD(DAY, -30, GETDATE()) THEN 1 ELSE 0 END) AS ultimos30d
    FROM dbo.imPedidosEstudiosAdjuntos
  `);

	const patchServidorBuckets = await q(`
    SELECT ${bucket('PatchServidor')} AS bucket, COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    GROUP BY ${bucket('PatchServidor')}
    ORDER BY n DESC
  `);

	const patchBuckets = await q(`
    SELECT ${bucket('Patch')} AS bucket, COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    GROUP BY ${bucket('Patch')}
    ORDER BY n DESC
  `);

	const clarionRisk = await q(`
    SELECT
      SUM(CASE
        WHEN PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%' THEN 1 ELSE 0 END) AS ok_clarion_abre_unc,
      SUM(CASE
        WHEN PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
          OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE 'E:\\adjuntos\\%' THEN 1 ELSE 0 END) AS mal_e_local,
      SUM(CASE WHEN PatchServidor IS NULL OR LTRIM(RTRIM(PatchServidor)) = '' THEN 1 ELSE 0 END) AS mal_vacio,
      SUM(CASE WHEN PatchServidor LIKE '\\\\192.%\\%' THEN 1 ELSE 0 END) AS unc_ip,
      COUNT(*) AS total
    FROM dbo.imPedidosEstudiosAdjuntos
  `);

	const mismatchWeb = await q(`
    SELECT COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
      AND (
        PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
        OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE 'E:\\adjuntos\\%'
      )
  `);

	const webBothUnc = await q(`
    SELECT COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
      AND (
        PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
  `);

	const mismatchSameVisitDiffPath = await q(`
    SELECT COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
      AND LTRIM(RTRIM(ISNULL(PatchServidor,''))) <> ''
      AND REPLACE(LOWER(Patch), '\\\\server\\\\', '\\\\server\\\\')
        <> REPLACE(LOWER(PatchServidor), '\\\\server\\\\', '\\\\server\\\\')
      AND NOT (
        PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
  `);

	const recentRisk = await q(`
    SELECT
      SUM(CASE WHEN Fecha >= DATEADD(HOUR, -24, GETDATE()) THEN 1 ELSE 0 END) AS h24,
      SUM(CASE WHEN Fecha >= DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END) AS d7,
      SUM(CASE WHEN Fecha >= DATEADD(DAY, -30, GETDATE()) THEN 1 ELSE 0 END) AS d30
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
       OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
       OR PatchServidor LIKE 'E:\\adjuntos\\%'
  `);

	const recentOkWeb = await q(`
    SELECT
      SUM(CASE WHEN Fecha >= DATEADD(HOUR, -24, GETDATE()) THEN 1 ELSE 0 END) AS h24,
      SUM(CASE WHEN Fecha >= DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END) AS d7
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
      AND (
        PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
  `);

	const samplesMal = await q(`
    SELECT TOP 25
      IdAdjunto, NumeroVisita, IdOperador, IdTipoImagen, IdSector, Fecha,
      LEFT(Descripcion, 50) AS Descripcion,
      LEFT(Patch, 110) AS Patch,
      LEFT(PatchServidor, 110) AS PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
       OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
       OR PatchServidor LIKE 'E:\\adjuntos\\%'
    ORDER BY Fecha DESC
  `);

	const samplesMismatch = await q(`
    SELECT TOP 25
      IdAdjunto, NumeroVisita, IdOperador, Fecha,
      LEFT(Patch, 110) AS Patch,
      LEFT(PatchServidor, 110) AS PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
      AND (
        PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
        OR PatchServidor LIKE 'E:\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE 'E:\\adjuntos\\%'
      )
    ORDER BY Fecha DESC
  `);

	const lastWeb24h = await q(`
    SELECT TOP 20
      IdAdjunto, NumeroVisita, IdOperador, Fecha,
      LEFT(Patch, 100) AS Patch,
      LEFT(PatchServidor, 100) AS PatchServidor,
      CASE
        WHEN PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%' THEN 'OK_UNC'
        WHEN PatchServidor LIKE 'E:\\%' THEN 'MAL_E'
        ELSE 'REVISAR'
      END AS veredicto
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE Fecha >= DATEADD(HOUR, -24, GETDATE())
      AND (
        Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE 'E:\\imagenes\\vidal\\%'
        OR PatchServidor LIKE 'E:\\adjuntos\\%'
      )
    ORDER BY Fecha DESC
  `);

	const vacios = await q(`
    SELECT TOP 15
      IdAdjunto, NumeroVisita, Fecha,
      LEFT(ISNULL(Patch,'(null)'), 110) AS Patch,
      LEFT(ISNULL(PatchServidor,'(null)'), 110) AS PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor IS NULL OR LTRIM(RTRIM(PatchServidor)) = ''
    ORDER BY Fecha DESC
  `);

	const uncIp = await q(`
    SELECT TOP 15
      IdAdjunto, NumeroVisita, Fecha,
      LEFT(Patch, 110) AS Patch,
      LEFT(PatchServidor, 110) AS PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor LIKE '\\\\192.%\\%'
    ORDER BY Fecha DESC
  `);

	const psOtro = await q(`
    SELECT TOP 20
      IdAdjunto, NumeroVisita, Fecha,
      LEFT(Patch, 110) AS Patch,
      LEFT(PatchServidor, 110) AS PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor IS NOT NULL
      AND LTRIM(RTRIM(PatchServidor)) <> ''
      AND PatchServidor NOT LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
      AND PatchServidor NOT LIKE '\\\\server\\Imagenes\\Vidal\\%'
      AND PatchServidor NOT LIKE '\\\\192.%\\%'
      AND PatchServidor NOT LIKE 'E:\\imagenes\\vidal\\%'
      AND PatchServidor NOT LIKE 'E:\\Imagenes\\Vidal\\%'
      AND PatchServidor NOT LIKE 'E:\\adjuntos\\%'
    ORDER BY Fecha DESC
  `);

	const vaciosCountByYear = await q(`
    SELECT YEAR(Fecha) AS anio, COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor IS NULL OR LTRIM(RTRIM(PatchServidor)) = ''
    GROUP BY YEAR(Fecha)
    ORDER BY anio DESC
  `);

	const uncIpByYear = await q(`
    SELECT YEAR(Fecha) AS anio, COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE PatchServidor LIKE '\\\\192.%\\%'
    GROUP BY YEAR(Fecha)
    ORDER BY anio DESC
  `);

	const lopez = await q(`
    SELECT IdAdjunto, NumeroVisita, IdOperador, Fecha, Descripcion,
           Patch, PatchServidor
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE IdAdjunto IN (167660, 167590)
       OR NumeroVisita = 476024
    ORDER BY IdAdjunto DESC
  `);

	const patchServidorVsPatch = await q(`
    SELECT
      SUM(CASE
        WHEN (
          Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
        ) AND (
          PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%'
        ) AND LOWER(REPLACE(Patch,'/','\\')) = LOWER(REPLACE(PatchServidor,'/','\\'))
        THEN 1 ELSE 0 END) AS web_patch_igual_ps,
      SUM(CASE
        WHEN (
          Patch LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR Patch LIKE '\\\\server\\Imagenes\\Vidal\\%'
        ) AND (
          PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
          OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%'
        ) AND LOWER(REPLACE(Patch,'/','\\')) <> LOWER(REPLACE(PatchServidor,'/','\\'))
        THEN 1 ELSE 0 END) AS web_ambos_unc_distintos
    FROM dbo.imPedidosEstudiosAdjuntos
  `);

	const nativeClarion = await q(`
    SELECT COUNT(*) AS n
    FROM dbo.imPedidosEstudiosAdjuntos
    WHERE (
        Patch LIKE '[A-Z]:\\%'
        OR Patch LIKE '\\\\192.%'
      )
      AND (
        PatchServidor LIKE '\\\\SERVER\\Imagenes\\Vidal\\%'
        OR PatchServidor LIKE '\\\\server\\Imagenes\\Vidal\\%'
      )
  `);

	const report = {
		meta,
		totals: totals[0],
		clarionRisk: clarionRisk[0],
		mismatchWebPatchUncPsE: mismatchWeb[0].n,
		webBothUnc: webBothUnc[0].n,
		webPatchIgualPs: patchServidorVsPatch[0].web_patch_igual_ps,
		webAmbosUncDistintos: patchServidorVsPatch[0].web_ambos_unc_distintos,
		nativeClarionOk: nativeClarion[0].n,
		mismatchOther: mismatchSameVisitDiffPath[0].n,
		recentMalE: recentRisk[0],
		recentWebOkUnc: recentOkWeb[0],
		patchBuckets,
		patchServidorBuckets,
		samplesMal,
		samplesMismatch,
		lastWeb24h,
		lopez,
		vacios,
		vaciosCountByYear,
		uncIp,
		uncIpByYear,
		psOtro,
	};

	console.log(JSON.stringify(report, null, 2));

	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
