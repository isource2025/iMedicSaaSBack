const crypto = require('crypto');
const { executeQuery, getRequestPool, sql } = require('../models/db');
const personalServicios = require('./personalServicios.service');
const { codesRelated } = require('../utils/sectorServicioMatch');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	fechaCalendarioArgentina,
	horaWallArgentina,
	partesFechaHoraArgentina,
} = require('../utils/dateUtils');

function _s(v, max) {
	if (v == null) return '';
	const s = String(v);
	return max != null ? s.slice(0, max) : s;
}

function _padSector(v) {
	return String(v || '').trim().padEnd(4, ' ').slice(0, 4);
}

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

function plainToRtf(plain) {
	const text = String(plain || '')
		.replace(/\\/g, '\\\\')
		.replace(/\{/g, '\\{')
		.replace(/\}/g, '\\}')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/\n/g, '\\par\r\n');
	return (
		'{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat{\\fonttbl{\\f0\\fnil\\fcharset0 Microsoft Sans Serif;}}\r\n' +
		`{\\*\\generator iMedicSaaS}\\viewkind4\\uc1 \r\n\\pard\\f0\\fs18 ${text}\\par\r\n}\r\n`
	);
}

/**
 * RTF Clarion / RichEdit → texto plano legible (sin fonttbl / generator / basura).
 */
function rtfToPlain(rtf) {
	if (rtf == null) return '';
	let s = String(rtf);
	const esRtf = /\\rtf\d?/i.test(s) || /\{\\rtf/i.test(s) || /\\fonttbl/i.test(s) || /\\par\b/i.test(s);
	if (!esRtf) return _limpiarBasuraTextoResultado(s).trim();

	// Quitar grupos de metadatos anidados (fonttbl, colortbl, generator, etc.)
	s = _stripRtfMetaGroups(s);

	s = s.replace(/\\par[d]?\b/gi, '\n');
	s = s.replace(/\\line\b/gi, '\n');
	s = s.replace(/\\tab\b/gi, '\t');
	s = s.replace(/\\'[0-9a-fA-F]{2}/g, (m) => {
		try {
			return String.fromCharCode(parseInt(m.slice(2), 16));
		} catch {
			return '';
		}
	});
	s = s.replace(/\\u(-?\d+)\??/g, (_, n) => {
		const code = Number(n);
		if (!Number.isFinite(code)) return '';
		const c = code < 0 ? code + 65536 : code;
		return c > 0 ? String.fromCharCode(c) : '';
	});
	// Control words: \b, \f0, \fs18, \ansi, etc.
	s = s.replace(/\\[a-z]+(-?\d+)?[ ]?/gi, '');
	// Destinos / escapes residuales (\*, \{, etc.)
	s = s.replace(/\\[^a-zA-Z\n]?/g, '');
	s = s.replace(/[{}]/g, '');
	s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	return _limpiarBasuraTextoResultado(s).replace(/\n{3,}/g, '\n\n').trim();
}

/** Elimina {\\fonttbl...}, {\\*\\generator...}, etc. por balance de llaves. */
function _stripRtfMetaGroups(input) {
	let s = String(input || '');
	const markers = [
		'\\fonttbl',
		'\\colortbl',
		'\\stylesheet',
		'\\listtable',
		'\\listoverridetable',
		'\\info',
		'\\generator',
		'\\*\\generator',
		'\\*\\themedata',
		'\\*\\colorschememapping',
		'\\*\\latentstyles',
		'\\*\\expandedcolortbl',
		'\\*\\datastore',
	];
	for (let pass = 0; pass < 30; pass++) {
		let removed = false;
		for (const marker of markers) {
			const idx = s.toLowerCase().indexOf(marker.toLowerCase());
			if (idx < 0) continue;
			// Buscar '{' que abre este grupo
			let start = idx;
			while (start > 0 && s[start] !== '{') start -= 1;
			if (s[start] !== '{') continue;
			let depth = 0;
			let end = -1;
			for (let i = start; i < s.length; i++) {
				if (s[i] === '{') depth += 1;
				else if (s[i] === '}') {
					depth -= 1;
					if (depth === 0) {
						end = i;
						break;
					}
				}
			}
			if (end < 0) continue;
			s = s.slice(0, start) + s.slice(end + 1);
			removed = true;
			break;
		}
		if (!removed) break;
	}
	return s;
}

function _limpiarBasuraTextoResultado(texto) {
	return String(texto || '')
		.replace(/Times New Roman;?/gi, '')
		.replace(/Microsoft Sans Serif;?/gi, '')
		.replace(/\bArial;/gi, '')
		.replace(/\\\*?Msftedit[^\n]*/gi, '')
		.replace(/\*?Msftedit[^\n;]*;?/gi, '')
		.replace(/^\s*;+\s*$/gm, '')
		.replace(/^[;\s]+/gm, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function _fechaHoraArgentina(fechaPedido, isoFallback, horaFallback) {
	let d = null;
	if (fechaPedido instanceof Date && !Number.isNaN(fechaPedido.getTime())) {
		d = fechaPedido;
	} else if (fechaPedido != null && fechaPedido !== '') {
		const t = Date.parse(String(fechaPedido));
		if (Number.isFinite(t)) d = new Date(t);
	}
	if (!d && isoFallback) {
		const raw = `${String(isoFallback).slice(0, 10)}T${String(horaFallback || '00:00').slice(0, 5)}:00Z`;
		const t = Date.parse(raw);
		if (Number.isFinite(t)) d = new Date(t);
	}
	if (!d) {
		return {
			FechaPedidoISO: isoFallback || null,
			HoraPedido: horaFallback || null,
		};
	}
	const tz = 'America/Argentina/Buenos_Aires';
	return {
		FechaPedidoISO: d.toLocaleDateString('en-CA', { timeZone: tz }),
		HoraPedido: d.toLocaleTimeString('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		}),
	};
}

function mapPedidoRow(row) {
	const idProtocolo = Number(row.IdProtocolo) || 0;
	const cumplido = idProtocolo > 0;
	const textoRtf = row.TextoProtocolo != null ? String(row.TextoProtocolo) : null;
	const matriculaToma =
		row.MatriculaToma != null ? Number(row.MatriculaToma) : null;
	const tomado = Number.isFinite(matriculaToma) && matriculaToma > 0;
	const fh = _fechaHoraArgentina(row.FechaPedido, row.FechaPedidoISO, row.HoraPedido);
	const clase = String(row.ClasePaciente || '')
		.trim()
		.toUpperCase();
	const tipoAdm = String(row.TipoAdmision || '')
		.trim()
		.toUpperCase();
	let tipoAtencion = null;
	if (clase === 'A' || tipoAdm === 'A' || /AMBUL/.test(tipoAdm)) tipoAtencion = 'AMBULATORIO';
	else if (clase === 'I' || tipoAdm === 'I' || /INTERN/.test(tipoAdm)) tipoAtencion = 'INTERNADO';
	else if (row.UbicacionCama) tipoAtencion = 'INTERNADO';
	else if (Number(row.IdVisita) > 0) tipoAtencion = clase ? clase : null;

	const hab = String(row.ValorHabitacionCama || '').trim();
	const secCama = String(row.SectorCama || row.ValorSectorCama || '').trim();
	const secCamaNom = String(row.SectorCamaNombre || '').trim();
	let ubicacion = null;
	if (hab || secCama) {
		const partes = [];
		if (secCamaNom || secCama) partes.push(secCamaNom || secCama);
		if (hab) partes.push(`Cama ${hab}`);
		ubicacion = partes.join(' · ');
	}

	return {
		IdPedido: Number(row.IdPedido) || 0,
		IdVisita: Number(row.IdVisita) || 0,
		FechaPedido: row.FechaPedido,
		FechaPedidoISO: fh.FechaPedidoISO,
		HoraPedido: fh.HoraPedido,
		IdTipoPedido: row.IdTipoPedido != null ? Number(row.IdTipoPedido) : null,
		TipoPedidoDescripcion: row.TipoPedidoDescripcion
			? String(row.TipoPedidoDescripcion).trim()
			: null,
		CodigoPractica: row.CodigoPractica != null ? Number(row.CodigoPractica) : null,
		PracticaSolicitada: String(row.PracticaSolicitada || '').trim(),
		NomencladorDescripcion: row.NomencladorDescripcion
			? String(row.NomencladorDescripcion).trim()
			: null,
		NotasObservacion: row.NotasObservacion
			? String(row.NotasObservacion).trim()
			: null,
		MatriculaSolicitante:
			row.MatriculaSolicitante != null ? Number(row.MatriculaSolicitante) : null,
		MedicoSolicitanteNombre:
			String(row.MedicoSolicitanteNombre || '').trim() || null,
		IdProtocolo: idProtocolo > 0 ? idProtocolo : 0,
		Cumplido: cumplido,
		EstadoUrgencia: row.EstadoUrgencia ? String(row.EstadoUrgencia).trim() : null,
		SectorSolicitante: row.SectorSolicitante
			? String(row.SectorSolicitante).trim()
			: null,
		SectorSolicitanteNombre: row.SectorSolicitanteNombre
			? String(row.SectorSolicitanteNombre).trim()
			: null,
		SectorReceptor: row.SectorReceptor ? String(row.SectorReceptor).trim() : null,
		SectorReceptorNombre: row.SectorReceptorNombre
			? String(row.SectorReceptorNombre).trim()
			: null,
		ServicioCodigo: row.ServicioCodigo ? String(row.ServicioCodigo).trim() : null,
		ServicioDescripcion: row.ServicioDescripcion
			? String(row.ServicioDescripcion).trim()
			: null,
		CategoriaPedido: row.CategoriaPedido || null,
		TextoResultado: cumplido && textoRtf ? rtfToPlain(textoRtf) : null,
		FechaResultado: row.FechaResultado || null,
		PracticaFacturada:
			row.PracticaFacturada != null ? Number(row.PracticaFacturada) : null,
		MatriculaRealizador:
			row.MatriculaRealizador != null
				? Number(row.MatriculaRealizador)
				: matriculaToma,
		RealizadorNombre: row.RealizadorNombre
			? String(row.RealizadorNombre).trim()
			: row.NombreToma
				? String(row.NombreToma).trim()
				: null,
		Tomado: tomado,
		MatriculaToma: tomado ? matriculaToma : null,
		NombreToma: row.NombreToma ? String(row.NombreToma).trim() : null,
		FechaToma: row.FechaToma || null,
		EstadoWorkflow: cumplido ? 'CUMPLIDO' : tomado ? 'TOMADO' : 'PENDIENTE',
		PacienteNombre: row.PacienteNombre ? String(row.PacienteNombre).trim() : null,
		PacienteDocumento:
			row.PacienteDocumento != null && String(row.PacienteDocumento).trim() !== ''
				? String(row.PacienteDocumento).trim()
				: null,
		PacienteSexo: row.PacienteSexo ? String(row.PacienteSexo).trim() : null,
		PacienteSexoDescripcion: row.PacienteSexoDescripcion
			? String(row.PacienteSexoDescripcion).trim()
			: null,
		ObraSocial: row.ObraSocial ? String(row.ObraSocial).trim() : null,
		TipoAtencion: tipoAtencion,
		Ubicacion: ubicacion,
		IdPaciente: row.IdPaciente != null ? Number(row.IdPaciente) : null,
	};
}

const SELECT_PEDIDO = `
  pe.IdPedido,
  pe.IdVisita,
  pe.FechaPedido,
  CONVERT(varchar(10), pe.FechaPedido, 23) AS FechaPedidoISO,
  CONVERT(varchar(5), pe.FechaPedido, 108) AS HoraPedido,
  pe.IdTipoPedido,
  LTRIM(RTRIM(ISNULL(tp.DescPractica, ISNULL(nom.Descripcion, '')))) AS TipoPedidoDescripcion,
  pe.IdPractica AS CodigoPractica,
  LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(tp.DescPractica, ''))), ''), ISNULL(nom.Descripcion, '')))) AS PracticaSolicitada,
  LTRIM(RTRIM(ISNULL(nom.Descripcion, ''))) AS NomencladorDescripcion,
  pe.NotasObservacion,
  pe.ValorProfesional AS MatriculaSolicitante,
  LTRIM(RTRIM(ISNULL(sol.ApellidoNombre, ''))) AS MedicoSolicitanteNombre,
  pe.IdProtocolo,
  pe.EstadoUrgencia,
  LTRIM(RTRIM(ISNULL(pe.IdSectorSolicitante, ''))) AS SectorSolicitante,
  secSol.Descripcion AS SectorSolicitanteNombre,
  LTRIM(RTRIM(ISNULL(pe.IdSectorReceptor, ''))) AS SectorReceptor,
  secRec.Descripcion AS SectorReceptorNombre,
  LTRIM(RTRIM(ISNULL(srv.Valor, ''))) AS ServicioCodigo,
  srv.Descripcion AS ServicioDescripcion,
  CASE WHEN pe.IdTipoPedido = 33 THEN 'INTERCONSULTA' ELSE 'ESTUDIO' END AS CategoriaPedido,
  pr.TextoProtocolo,
  pr.FechaResultado,
  fac.Practica AS PracticaFacturada,
  fprof.Matricula AS MatriculaRealizador,
  realiz.ApellidoNombre AS RealizadorNombre,
  toma.Matricula AS MatriculaToma,
  toma.FechaToma,
  tomaPer.ApellidoNombre AS NombreToma,
  v.IDPACIENTE AS IdPaciente,
  LTRIM(RTRIM(ISNULL(v.CLASEPACIENTE, ''))) AS ClasePaciente,
  LTRIM(RTRIM(ISNULL(v.TIPOADMISION, ''))) AS TipoAdmision,
  LTRIM(RTRIM(ISNULL(pac.ApellidoyNombre, ''))) AS PacienteNombre,
  pac.NumeroDocumento AS PacienteDocumento,
  LTRIM(RTRIM(ISNULL(pac.Sexo, ''))) AS PacienteSexo,
  LTRIM(RTRIM(ISNULL(sx.Descripcion, ''))) AS PacienteSexoDescripcion,
  LTRIM(RTRIM(ISNULL(cob.RazonSocial, ''))) AS ObraSocial,
  CASE
    WHEN LTRIM(RTRIM(ISNULL(hc.ValorHabitacionCama, ''))) <> '' THEN LTRIM(RTRIM(hc.ValorHabitacionCama))
    WHEN LTRIM(RTRIM(ISNULL(v.VALORHABITACIONCAMA, ''))) <> '' THEN LTRIM(RTRIM(v.VALORHABITACIONCAMA))
    ELSE LTRIM(RTRIM(ISNULL(mov.MovCama, '')))
  END AS ValorHabitacionCama,
  CASE
    WHEN LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) <> '' THEN LTRIM(RTRIM(hc.ValorSector))
    WHEN LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) <> '' THEN LTRIM(RTRIM(v.VALORSECTOR))
    ELSE LTRIM(RTRIM(ISNULL(mov.MovSector, '')))
  END AS ValorSectorCama,
  LTRIM(RTRIM(ISNULL(secCama.Descripcion, ''))) AS SectorCamaNombre,
  CASE
    WHEN ISNULL(hc.NumeroVisita, 0) > 0 THEN 1
    WHEN LTRIM(RTRIM(ISNULL(v.VALORHABITACIONCAMA, ''))) <> '' THEN 1
    WHEN LTRIM(RTRIM(ISNULL(mov.MovCama, ''))) <> '' THEN 1
    ELSE 0
  END AS UbicacionCama
`;

const FROM_PEDIDO = `
  FROM dbo.imPedidosEstudios pe
  OUTER APPLY (
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(t.DescPractica, ''))) AS DescPractica
    FROM dbo.imTiposPedidosEstudios t
    WHERE (ISNULL(pe.IdPractica, 0) > 0 AND t.IdPractica = pe.IdPractica)
       OR (ISNULL(pe.IdTipoPedido, 0) > 0 AND t.IdTipoPedido = pe.IdTipoPedido)
    ORDER BY
      CASE WHEN ISNULL(pe.IdPractica, 0) > 0 AND t.IdPractica = pe.IdPractica THEN 0 ELSE 1 END,
      CASE WHEN ISNULL(pe.IdTipoPedido, 0) > 0 AND t.IdTipoPedido = pe.IdTipoPedido THEN 0 ELSE 1 END
  ) tp
  OUTER APPLY (
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(n.Descripcion, ''))) AS Descripcion
    FROM dbo.imNomenclador n
    WHERE n.IDPractica = pe.IdPractica
  ) nom
  OUTER APPLY (
    SELECT TOP 1 n.ApellidoNombre
    FROM (
      SELECT
        COALESCE(
          NULLIF(LTRIM(RTRIM(ISNULL(p.ApellidoNombre, ''))), ''),
          NULLIF(LTRIM(RTRIM(
            RTRIM(LTRIM(ISNULL(pw.Apellido, ''))) +
            CASE
              WHEN LTRIM(RTRIM(ISNULL(pw.Nombres, ''))) = '' THEN ''
              ELSE ' ' + LTRIM(RTRIM(pw.Nombres))
            END
          )), '')
        ) AS ApellidoNombre,
        CASE WHEN p.Matricula = pe.ValorProfesional THEN 0 ELSE 1 END AS Ord
      FROM dbo.imPersonal p
      LEFT JOIN dbo.imPassword pw ON pw.ValorPersonal = p.Valor
      WHERE ISNULL(pe.ValorProfesional, 0) <> 0
        AND (p.Valor = pe.ValorProfesional OR p.Matricula = pe.ValorProfesional)
      UNION ALL
      SELECT
        NULLIF(LTRIM(RTRIM(
          RTRIM(LTRIM(ISNULL(pw2.Apellido, ''))) +
          CASE
            WHEN LTRIM(RTRIM(ISNULL(pw2.Nombres, ''))) = '' THEN ''
            ELSE ' ' + LTRIM(RTRIM(pw2.Nombres))
          END
        )), ''),
        2
      FROM dbo.imPassword pw2
      WHERE ISNULL(pe.ValorProfesional, 0) <> 0
        AND (pw2.ValorPersonal = pe.ValorProfesional OR pw2.CodOperador = pe.ValorProfesional)
    ) n
    WHERE NULLIF(LTRIM(RTRIM(ISNULL(n.ApellidoNombre, ''))), '') IS NOT NULL
    ORDER BY n.Ord
  ) sol
  LEFT JOIN dbo.imSectores secSol ON LTRIM(RTRIM(secSol.Valor)) = LTRIM(RTRIM(pe.IdSectorSolicitante))
  LEFT JOIN dbo.imSectores secRec ON LTRIM(RTRIM(secRec.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor))
  LEFT JOIN dbo.imServicios srv ON LTRIM(RTRIM(srv.Valor)) = LTRIM(RTRIM(pe.IdSectorReceptor))
  LEFT JOIN dbo.imProtocolosResultados pr ON pr.IdProtocolo = pe.IdProtocolo AND pe.IdProtocolo > 0
  LEFT JOIN dbo.imFacPracticas fac ON pe.IdProtocolo > 0 AND (
    fac.IdProtocolo = pe.IdProtocolo OR fac.Valor = pe.IdProtocolo
  )
  LEFT JOIN dbo.imFacProfesionales fprof ON fprof.Valor = fac.Valor AND fprof.Funcion = 1
  LEFT JOIN dbo.imPersonal realiz ON realiz.Matricula = fprof.Matricula
  LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
  LEFT JOIN dbo.imPersonal tomaPer ON tomaPer.Matricula = toma.Matricula
  LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = pe.IdVisita
  LEFT JOIN dbo.imPacientes pac ON pac.IDPaciente = v.IDPACIENTE
  LEFT JOIN dbo.imSexo sx ON sx.Valor = pac.Sexo
  LEFT JOIN dbo.imClientes cob ON cob.Valor = pac.NumeroCuenta
  LEFT JOIN dbo.imHabitacionCamas hc ON hc.NumeroVisita = pe.IdVisita AND ISNULL(hc.NumeroVisita, 0) > 0
  OUTER APPLY (
    SELECT TOP 1
      LTRIM(RTRIM(ISNULL(m.ValorHabitacionCama, ''))) AS MovCama,
      LTRIM(RTRIM(ISNULL(m.ValorSector, ''))) AS MovSector
    FROM dbo.imVisitaMovimiento m
    WHERE m.NumeroVisita = pe.IdVisita
      AND (
        LTRIM(RTRIM(ISNULL(m.ValorHabitacionCama, ''))) <> ''
        OR LTRIM(RTRIM(ISNULL(m.ValorSector, ''))) <> ''
      )
    ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC
  ) mov
  LEFT JOIN dbo.imSectores secCama ON LTRIM(RTRIM(secCama.Valor)) = LTRIM(RTRIM(
    CASE
      WHEN LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) <> '' THEN hc.ValorSector
      WHEN LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) <> '' THEN v.VALORSECTOR
      ELSE ISNULL(mov.MovSector, '')
    END
  ))
`;

let _tomaTableReady = false;

/** Tabla SaaS: un solo operador puede tomar un pedido (PK = IdPedido). */
async function ensureTomaTable() {
	if (_tomaTableReady) return;
	await executeQuery(`
		IF OBJECT_ID(N'dbo.imPedidosEstudiosToma', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imPedidosEstudiosToma (
				IdPedido     INT NOT NULL PRIMARY KEY,
				Matricula    INT NOT NULL,
				CodOperador  INT NULL,
				FechaToma    DATETIME NOT NULL CONSTRAINT DF_imPedidosEstudiosToma_Fecha DEFAULT (GETDATE())
			);
			CREATE INDEX IX_imPedidosEstudiosToma_Matricula
				ON dbo.imPedidosEstudiosToma (Matricula);
		END
	`);
	_tomaTableReady = true;
}

async function _obtenerToma(idPedido) {
	await ensureTomaTable();
	const rows = await executeQuery(
		`SELECT TOP 1 t.IdPedido, t.Matricula, t.CodOperador, t.FechaToma,
		        p.ApellidoNombre AS Nombre
		 FROM dbo.imPedidosEstudiosToma t
		 LEFT JOIN dbo.imPersonal p ON p.Matricula = t.Matricula
		 WHERE t.IdPedido = @p0`,
		[{ value: Number(idPedido), type: 'Int' }],
	);
	return rows?.[0] || null;
}

async function resolverTipoPedidoEstudio(idTipoPedido, idPractica) {
	const idTipo = Number(idTipoPedido);
	const idPrac = Number(idPractica);
	if (Number.isFinite(idPrac) && idPrac > 0) {
		const byPrac = await executeQuery(
			`SELECT TOP 1 IdTipoPedido, DescPractica, IdPractica
			 FROM dbo.imTiposPedidosEstudios
			 WHERE IdPractica = @p0
			 ORDER BY CASE WHEN IdTipoPedido = @p1 THEN 0 ELSE 1 END, IdTipoPedido`,
			[
				{ value: idPrac, type: 'Int' },
				{ value: Number.isFinite(idTipo) && idTipo > 0 ? idTipo : 0, type: 'Int' },
			],
		);
		if (byPrac.length) return byPrac[0];
	}
	if (!Number.isFinite(idTipo) || idTipo <= 0) throw _httpError('idTipoPedido inválido');
	const rows = await executeQuery(
		`SELECT TOP 1 IdTipoPedido, DescPractica, IdPractica
		 FROM dbo.imTiposPedidosEstudios
		 WHERE IdTipoPedido = @p0
		 ORDER BY IdPractica`,
		[{ value: idTipo, type: 'Int' }],
	);
	if (!rows.length) throw _httpError(`Tipo de pedido/estudio ${idTipo} inexistente`, 404);
	return rows[0];
}

function _mapServiciosRows(rows) {
	return (rows || [])
		.map((r) => ({
			valor: String(r.valor || '').trim(),
			descripcion: String(r.descripcion || '').trim(),
			prefijos: String(r.prefijosPractica || '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		}))
		.filter((s) => s.valor);
}

async function listarSectoresReceptor({ valorPersonal } = {}) {
	const vp = Number(valorPersonal);
	if (Number.isFinite(vp) && vp > 0) {
		const rows = await personalServicios.listarParaBandeja(vp);
		return _mapServiciosRows(rows);
	}

	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(Valor)) AS valor, RTRIM(LTRIM(Descripcion)) AS descripcion,
		        RTRIM(LTRIM(ISNULL(PrefijosPractica, ''))) AS prefijosPractica
		 FROM dbo.imServicios
		 WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''
		 ORDER BY Descripcion`,
	);
	return _mapServiciosRows(rows);
}

async function contarLibresPorServicios({ valorPersonal } = {}) {
	await ensureTomaTable();
	const sectores = await listarSectoresReceptor({ valorPersonal });
	const codes = [
		...new Set(
			(
				await Promise.all(
					sectores.map((s) => expandCodigosReceptor(String(s.valor || '').trim())),
				)
			).flat(),
		),
	].filter(Boolean);
	const vacio = {
		estudios: 0,
		interconsultas: 0,
		urgentes: 0,
		porServicio: [],
	};
	if (!codes.length) return vacio;

	const params = codes.map((c) => ({ value: c, type: 'VarChar' }));
	const inList = codes.map((_, i) => `LTRIM(RTRIM(@p${i}))`).join(', ');
	const rows = await executeQuery(
		`SELECT
		    LTRIM(RTRIM(pe.IdSectorReceptor)) AS valor,
		    ISNULL(SUM(CASE WHEN ISNULL(pe.IdTipoPedido, 0) <> 33 THEN 1 ELSE 0 END), 0) AS estudios,
		    ISNULL(SUM(CASE WHEN pe.IdTipoPedido = 33 THEN 1 ELSE 0 END), 0) AS interconsultas,
		    ISNULL(SUM(CASE
		      WHEN NULLIF(LTRIM(RTRIM(ISNULL(CAST(pe.EstadoUrgencia AS varchar(40)), ''))), '') IS NOT NULL
		      THEN 1 ELSE 0
		    END), 0) AS urgentes
		 FROM dbo.imPedidosEstudios pe
		 LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
		 WHERE LTRIM(RTRIM(pe.IdSectorReceptor)) IN (${inList})
		   AND (pe.IdProtocolo IS NULL OR pe.IdProtocolo = 0)
		   AND toma.IdPedido IS NULL
		 GROUP BY LTRIM(RTRIM(pe.IdSectorReceptor))`,
		params,
	);

	const byCode = new Map();
	for (const r of rows || []) {
		const key = String(r.valor || '').trim().toUpperCase();
		if (!key) continue;
		byCode.set(key, {
			estudios: Number(r.estudios) || 0,
			interconsultas: Number(r.interconsultas) || 0,
			urgentes: Number(r.urgentes) || 0,
		});
	}

	const porServicio = sectores
		.map((s) => {
			let estudios = 0;
			let interconsultas = 0;
			let urgentes = 0;
			for (const [key, hit] of byCode) {
				if (codesRelated(s.valor, key)) {
					estudios += hit.estudios;
					interconsultas += hit.interconsultas;
					urgentes += hit.urgentes;
				}
			}
			return {
				valor: s.valor,
				descripcion: s.descripcion || s.valor,
				estudios,
				interconsultas,
				urgentes,
				total: estudios + interconsultas,
			};
		})
		.sort(
			(a, b) =>
				b.total - a.total ||
				b.urgentes - a.urgentes ||
				String(a.descripcion).localeCompare(String(b.descripcion), 'es'),
		);

	return {
		estudios: porServicio.reduce((n, s) => n + s.estudios, 0),
		interconsultas: porServicio.reduce((n, s) => n + s.interconsultas, 0),
		urgentes: porServicio.reduce((n, s) => n + s.urgentes, 0),
		porServicio,
	};
}

/**
 * Un código de login/filtro (imSectores o imServicios) puede mapear a varios
 * IdSectorReceptor distintos (CIR ≈ CIRUGIA). La bandeja tiene que ver todos.
 */
async function expandCodigosReceptor(sectorReceptor) {
	const raw = String(sectorReceptor || '').trim();
	if (!raw) return [];
	const seen = new Set();
	const out = [];
	const add = (c) => {
		const v = String(c || '').trim();
		if (!v) return;
		const k = v.toUpperCase();
		if (seen.has(k)) return;
		seen.add(k);
		out.push(v);
	};
	add(raw);
	try {
		const rows = await executeQuery(
			`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor
			 FROM dbo.imServicios
			 WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''`,
		);
		for (const r of rows || []) {
			const v = String(r.valor || '').trim();
			if (v && codesRelated(raw, v)) add(v);
		}
	} catch {
		/* catálogo ausente */
	}
	return out;
}

async function buscarTiposPedidosEstudios({ q, limit = 30 }) {
	const term = String(q || '').trim();
	const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
	if (term.length < 2) return [];
	const like = `%${term}%`;
	const rows = await executeQuery(
		`SELECT TOP ${lim}
		        IdTipoPedido,
		        RTRIM(LTRIM(DescPractica)) AS descripcion,
		        IdPractica AS idPractica
		 FROM dbo.imTiposPedidosEstudios
		 WHERE (IdTipoPedido IS NULL OR IdTipoPedido <> 33)
		   AND (
		     DescPractica LIKE @p0
		     OR CAST(IdPractica AS VARCHAR(20)) LIKE @p0
		     OR CAST(IdTipoPedido AS VARCHAR(20)) LIKE @p0
		   )
		 ORDER BY DescPractica`,
		[{ value: like, type: 'VarChar' }],
	);
	return rows.map((r) => ({
		idTipoPedido: r.IdTipoPedido,
		descripcion: r.descripcion,
		idPractica: r.idPractica,
	}));
}

function dedupePedidos(rows) {
	const seen = new Set();
	const out = [];
	for (const r of rows || []) {
		const id = Number(r.IdPedido) || 0;
		if (id > 0) {
			if (seen.has(id)) continue;
			seen.add(id);
		}
		out.push(r);
	}
	return out;
}

/**
 * Crea una solicitud de estudio (IdProtocolo = 0).
 * Usado por Agenda (cierre turno) e Internación.
 * La fila de catálogo se resuelve por IdPractica (lo que eligió el usuario), no solo IdTipoPedido.
 */
async function crearPedido({
	idVisita,
	matriculaSolicitante,
	sectorSolicitante,
	idTipoPedido,
	idPractica,
	idSectorReceptor,
	notas,
	estadoUrgencia,
	fechaPedido,
}) {
	const numeroVisita = Number(idVisita);
	if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
		throw _httpError('idVisita inválido');
	}
	const matricula = Number(matriculaSolicitante);
	if (!Number.isFinite(matricula) || matricula <= 0) {
		throw _httpError('matriculaSolicitante inválida');
	}
	if (!String(idSectorReceptor || '').trim()) {
		throw _httpError('El sector receptor es obligatorio');
	}

	const tipo = await resolverTipoPedidoEstudio(idTipoPedido, idPractica);
	const codPractica = Number(tipo.IdPractica) || 0;
	if (codPractica <= 0) {
		throw _httpError(`Práctica inválida para pedido ${tipo.IdTipoPedido}`);
	}

	const urgRaw = String(estadoUrgencia || 'Normal').trim();
	const urgencia = ['Normal', 'Urgente', 'Medio'].includes(urgRaw) ? urgRaw : 'Normal';
	// Wall-clock Argentina: evita que Railway (UTC) guarde/muestre 3 h corridas.
	let now;
	if (fechaPedido instanceof Date && !Number.isNaN(fechaPedido.getTime())) {
		now = fechaPedido;
	} else {
		const { fecha, hora } = partesFechaHoraArgentina(new Date());
		now = new Date(`${fecha}T${hora}-03:00`);
	}

	const pedRows = await executeQuery(
		`INSERT INTO dbo.imPedidosEstudios (
			FechaPedido, NotasObservacion, ValorProfesional, IdVisita, IdPractica,
			IdProtocolo, EstadoUrgencia, IdSectorSolicitante, IdSectorReceptor, IdTipoPedido
		) VALUES (
			@p0, @p1, @p2, @p3, @p4,
			0, @p5, @p6, @p7, @p8
		);
		SELECT SCOPE_IDENTITY() AS IdPedido`,
		[
			{ value: now, type: 'DateTime' },
			{ value: _s(notas, 5000), type: 'VarChar' },
			{ value: matricula, type: 'Int' },
			{ value: numeroVisita, type: 'Int' },
			{ value: codPractica, type: 'Int' },
			{ value: urgencia, type: 'VarChar' },
			{ value: _padSector(sectorSolicitante), type: 'VarChar' },
			{ value: _padSector(idSectorReceptor), type: 'VarChar' },
			{ value: Number(tipo.IdTipoPedido), type: 'Int' },
		],
	);
	const idPedido = Number(pedRows[0]?.IdPedido) || 0;
	if (idPedido <= 0) throw _httpError('No se pudo registrar el pedido de estudio', 500);

	const result = {
		idPedido,
		idTipoPedido: Number(tipo.IdTipoPedido),
		descripcion: String(tipo.DescPractica || '').trim(),
		idPractica: codPractica,
	};

	// Campanita: avisar a profesionales del sector receptor (imPersonalSectores).
	try {
		const notificacionesPedidos = require('./notificacionesPedidos.service');
		void notificacionesPedidos.notificarPedidoSectorReceptor({
			idPedido,
			idVisita: numeroVisita,
			idTipoPedido: result.idTipoPedido,
			idSectorReceptor,
			descripcionPractica: result.descripcion,
			estadoUrgencia: urgencia,
			matriculaSolicitante: matricula,
		});
	} catch (err) {
		console.warn('[estudios] notif sector omitida:', err.message || err);
	}

	return result;
}

function _idsAutorSesion({ matricula, valorPersonal, codOperador }) {
	const ids = [];
	for (const v of [matricula, valorPersonal, codOperador]) {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
	}
	return ids;
}

/** Pendiente = sin toma y sin resultado. Tomado/respondido: nadie edita ni borra, ni el admin. */
async function _assertPedidoPendienteDelCreador(idPedido, sesion) {
	const ped = await obtenerPorId(idPedido);
	if (!ped) throw _httpError('Pedido no encontrado', 404);
	if (ped.Cumplido || Number(ped.IdProtocolo) > 0) {
		throw _httpError('El pedido ya fue respondido. Solo se puede visualizar.', 409);
	}
	if (ped.Tomado) {
		throw _httpError('El pedido ya fue tomado. Solo se puede visualizar.', 409);
	}
	const autor = Number(ped.MatriculaSolicitante);
	const ids = _idsAutorSesion(sesion || {});
	if (!Number.isFinite(autor) || autor <= 0 || !ids.includes(autor)) {
		throw _httpError(
			'Solo quien creó el pedido puede modificarlo o eliminarlo mientras está pendiente.',
			403,
		);
	}
	return ped;
}

async function actualizarPedido({
	idPedido,
	matricula,
	valorPersonal,
	codOperador,
	idTipoPedido,
	idPractica,
	idSectorReceptor,
	notas,
	estadoUrgencia,
}) {
	const id = Number(idPedido);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('idPedido inválido');
	await _assertPedidoPendienteDelCreador(id, { matricula, valorPersonal, codOperador });

	if (!String(idSectorReceptor || '').trim()) {
		throw _httpError('El sector receptor es obligatorio');
	}
	const tipo = await resolverTipoPedidoEstudio(idTipoPedido, idPractica);
	const codPractica = Number(tipo.IdPractica) || 0;
	if (codPractica <= 0) {
		throw _httpError(`Práctica inválida para pedido ${tipo.IdTipoPedido}`);
	}
	const urgRaw = String(estadoUrgencia || 'Normal').trim();
	const urgencia = ['Normal', 'Urgente', 'Medio'].includes(urgRaw) ? urgRaw : 'Normal';

	await executeQuery(
		`UPDATE dbo.imPedidosEstudios
		 SET NotasObservacion = @p1,
		     IdPractica = @p2,
		     EstadoUrgencia = @p3,
		     IdSectorReceptor = @p4,
		     IdTipoPedido = @p5
		 WHERE IdPedido = @p0
		   AND (IdProtocolo IS NULL OR IdProtocolo = 0)`,
		[
			{ value: id, type: 'Int' },
			{ value: _s(notas, 5000), type: 'VarChar' },
			{ value: codPractica, type: 'Int' },
			{ value: urgencia, type: 'VarChar' },
			{ value: _padSector(idSectorReceptor), type: 'VarChar' },
			{ value: Number(tipo.IdTipoPedido), type: 'Int' },
		],
	);
	return obtenerPorId(id);
}

async function eliminarPedido({ idPedido, matricula, valorPersonal, codOperador }) {
	const id = Number(idPedido);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('idPedido inválido');
	await _assertPedidoPendienteDelCreador(id, { matricula, valorPersonal, codOperador });
	await ensureTomaTable();
	await executeQuery(`DELETE FROM dbo.imPedidosEstudiosToma WHERE IdPedido = @p0`, [
		{ value: id, type: 'Int' },
	]);
	await executeQuery(
		`DELETE FROM dbo.imPedidosEstudios
		 WHERE IdPedido = @p0
		   AND (IdProtocolo IS NULL OR IdProtocolo = 0)`,
		[{ value: id, type: 'Int' }],
	);
	return { idPedido: id };
}

async function listarPorVisita(idVisita) {
	await ensureTomaTable();
	const rows = await executeQuery(
		`SELECT ${SELECT_PEDIDO}
		 ${FROM_PEDIDO}
		 WHERE pe.IdVisita = @p0
		   AND (pe.IdTipoPedido IS NULL OR pe.IdTipoPedido <> 33)
		 ORDER BY pe.FechaPedido DESC, pe.IdPedido DESC`,
		[{ value: Number(idVisita), type: 'Int' }],
	);
	return dedupePedidos((rows || []).map(mapPedidoRow));
}

/** Interconsultas (IdTipoPedido = 33) de una visita, con texto de respuesta si hay protocolo. */
async function listarInterconsultasPorVisita(idVisita) {
	await ensureTomaTable();
	const rows = await executeQuery(
		`SELECT ${SELECT_PEDIDO}
		 ${FROM_PEDIDO}
		 WHERE pe.IdVisita = @p0
		   AND pe.IdTipoPedido = 33
		 ORDER BY pe.FechaPedido DESC, pe.IdPedido DESC`,
		[{ value: Number(idVisita), type: 'Int' }],
	);
	return (rows || []).map(mapPedidoRow);
}

async function listarPendientesPorSector(sectorReceptor, opts = {}) {
	await ensureTomaTable();
	if (!String(sectorReceptor || '').trim()) {
		throw _httpError('sector receptor requerido');
	}
	const codes = await expandCodigosReceptor(sectorReceptor);
	if (!codes.length) {
		throw _httpError('sector receptor requerido');
	}
	const lim = Math.min(Math.max(Number(opts.limit) || 100, 1), 300);
	const paciente = String(opts.paciente || opts.q || '').trim();
	const fechaDesde = String(opts.fechaDesde || '').trim().slice(0, 10);
	const fechaHasta = String(opts.fechaHasta || '').trim().slice(0, 10);
	const soloIc = opts.soloInterconsultas === true || opts.categoria === 'INTERCONSULTA';
	const soloEst = opts.soloEstudios === true || opts.categoria === 'ESTUDIO';

	const params = codes.map((c) => ({ value: c, type: 'VarChar' }));
	const inList = codes.map((_, i) => `LTRIM(RTRIM(@p${i}))`).join(', ');
	let whereExtra = '';
	if (soloIc) {
		whereExtra += ' AND pe.IdTipoPedido = 33';
	} else if (soloEst) {
		whereExtra += ' AND (pe.IdTipoPedido IS NULL OR pe.IdTipoPedido <> 33)';
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde)) {
		params.push({ value: fechaDesde, type: 'VarChar' });
		whereExtra += ` AND CONVERT(date, pe.FechaPedido) >= CONVERT(date, @p${params.length - 1})`;
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
		params.push({ value: fechaHasta, type: 'VarChar' });
		whereExtra += ` AND CONVERT(date, pe.FechaPedido) <= CONVERT(date, @p${params.length - 1})`;
	}
	if (paciente) {
		const like = `%${paciente}%`;
		params.push({ value: like, type: 'VarChar' });
		const pi = params.length - 1;
		whereExtra += ` AND (
		  LTRIM(RTRIM(ISNULL(pac.ApellidoyNombre, ''))) LIKE @p${pi}
		  OR CAST(ISNULL(pac.NumeroDocumento, 0) AS VARCHAR(30)) LIKE @p${pi}
		)`;
	}

	const rows = await executeQuery(
		`SELECT TOP ${lim} ${SELECT_PEDIDO}
		 ${FROM_PEDIDO}
		 WHERE LTRIM(RTRIM(pe.IdSectorReceptor)) IN (${inList})
		   AND (pe.IdProtocolo IS NULL OR pe.IdProtocolo = 0)
		   ${whereExtra}
		 ORDER BY pe.FechaPedido DESC, pe.IdPedido DESC`,
		params,
	);
	return dedupePedidos((rows || []).map(mapPedidoRow));
}

async function obtenerPorId(idPedido) {
	await ensureTomaTable();
	const rows = await executeQuery(
		`SELECT ${SELECT_PEDIDO}
		 ${FROM_PEDIDO}
		 WHERE pe.IdPedido = @p0`,
		[{ value: Number(idPedido), type: 'Int' }],
	);
	if (!rows?.length) return null;
	return mapPedidoRow(rows[0]);
}

/**
 * Toma exclusiva del pedido (un solo operador). PK Impide doble toma.
 */
async function tomarPedido({ idPedido, matricula, codOperador }) {
	await ensureTomaTable();
	const id = Number(idPedido);
	const mat = Number(matricula);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('idPedido inválido');
	if (!Number.isFinite(mat) || mat <= 0) throw _httpError('matrícula inválida');

	const ped = await executeQuery(
		`SELECT TOP 1 IdPedido, IdProtocolo FROM dbo.imPedidosEstudios WHERE IdPedido = @p0`,
		[{ value: id, type: 'Int' }],
	);
	if (!ped?.length) throw _httpError('Pedido no encontrado', 404);
	if (Number(ped[0].IdProtocolo) > 0) {
		throw _httpError('El pedido ya está cumplido', 409);
	}

	const existente = await _obtenerToma(id);
	if (existente) {
		if (Number(existente.Matricula) === mat) {
			return obtenerPorId(id);
		}
		throw _httpError(
			`El pedido ya fue tomado por ${String(existente.Nombre || existente.Matricula).trim()}`,
			409,
		);
	}

	try {
		await executeQuery(
			`INSERT INTO dbo.imPedidosEstudiosToma (IdPedido, Matricula, CodOperador, FechaToma)
			 VALUES (@p0, @p1, @p2, GETDATE())`,
			[
				{ value: id, type: 'Int' },
				{ value: mat, type: 'Int' },
				{ value: Number(codOperador) || null, type: 'Int' },
			],
		);
	} catch (err) {
		const msg = String(err.message || '');
		if (/PRIMARY KEY|duplicate|UNIQUE/i.test(msg)) {
			const otra = await _obtenerToma(id);
			throw _httpError(
				`El pedido ya fue tomado por ${String(otra?.Nombre || otra?.Matricula || 'otro operador').trim()}`,
				409,
			);
		}
		throw err;
	}
	return obtenerPorId(id);
}

/** Libera la toma (solo quien la tomó). */
async function liberarPedido({ idPedido, matricula }) {
	await ensureTomaTable();
	const id = Number(idPedido);
	const mat = Number(matricula);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('idPedido inválido');
	if (!Number.isFinite(mat) || mat <= 0) throw _httpError('matrícula inválida');

	const toma = await _obtenerToma(id);
	if (!toma) throw _httpError('El pedido no está tomado', 409);
	if (Number(toma.Matricula) !== mat) {
		throw _httpError('Solo quien tomó el pedido puede liberarlo', 403);
	}

	const ped = await executeQuery(
		`SELECT TOP 1 IdProtocolo FROM dbo.imPedidosEstudios WHERE IdPedido = @p0`,
		[{ value: id, type: 'Int' }],
	);
	if (Number(ped?.[0]?.IdProtocolo) > 0) {
		throw _httpError('No se puede liberar un pedido ya cumplido', 409);
	}

	await executeQuery(`DELETE FROM dbo.imPedidosEstudiosToma WHERE IdPedido = @p0 AND Matricula = @p1`, [
		{ value: id, type: 'Int' },
		{ value: mat, type: 'Int' },
	]);
	return obtenerPorId(id);
}

/**
 * Cumple un pedido: solo quien lo tomó.
 * Facturación: imFacProfesionales.Matricula = matrícula de la toma (pago al operador).
 */
async function cumplirPedido({
	idPedido,
	textoInforme,
	matriculaRealizador,
	codOperador,
	sectorServicio,
	codPractica,
}) {
	await ensureTomaTable();
	const id = Number(idPedido);
	if (!Number.isFinite(id) || id <= 0) throw _httpError('idPedido inválido');

	const texto = String(textoInforme || '').trim();
	if (!texto) throw _httpError('El informe / resultado es obligatorio');

	const matriculaSesion = Number(matriculaRealizador);
	if (!Number.isFinite(matriculaSesion) || matriculaSesion <= 0) {
		throw _httpError('matrícula del realizador inválida');
	}

	const toma = await _obtenerToma(id);
	if (!toma) {
		throw _httpError('Debe tomar el pedido antes de cumplirlo', 409);
	}
	if (Number(toma.Matricula) !== matriculaSesion) {
		throw _httpError(
			'Solo puede cumplir quien tomó el pedido (' +
				String(toma.Nombre || toma.Matricula).trim() +
				')',
			403,
		);
	}
	/** Matrícula que cobra en facturación = quien tomó el pedido. */
	const matricula = Number(toma.Matricula);

	const pedRows = await executeQuery(
		"SELECT TOP 1 pe.IdPedido, pe.IdVisita, pe.IdPractica, pe.IdProtocolo, pe.IdSectorReceptor FROM dbo.imPedidosEstudios pe WHERE pe.IdPedido = @p0",
		[{ value: id, type: 'Int' }],
	);

	const pedido = pedRows?.[0];
	if (!pedido) throw _httpError('Pedido no encontrado', 404);

	const idProtActual = Number(pedido.IdProtocolo) || 0;
	if (idProtActual > 0) throw _httpError('El pedido ya está cumplido', 409);

	const numeroVisita = Number(pedido.IdVisita) || 0;
	if (numeroVisita <= 0) throw _httpError('Pedido sin visita asociada', 400);

	const visitaRows = await executeQuery(
		`SELECT TOP 1 IDPACIENTE AS IdPaciente FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
		[{ value: numeroVisita, type: 'Int' }],
	);
	const idPaciente = Number(visitaRows?.[0]?.IdPaciente) || 0;

	const practica =
		Number(codPractica) > 0
			? Number(codPractica)
			: Number(pedido.IdPractica) || 0;
	if (practica <= 0) throw _httpError('Código de práctica inválido para facturar');

	const sectorFac = _padSector(
		sectorServicio || pedido.IdSectorReceptor || '',
	);
	const codOp = Number(codOperador) || 0;
	const now = new Date();
	const fechaClarion = convertirFechaAClarion(fechaCalendarioArgentina(now));
	const horaClarion = convertirHoraAClarion(horaWallArgentina(true, now));
	const textoRtf = plainToRtf(texto);
	const sqlId = crypto.randomUUID().toUpperCase();

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	try {
		const reqRes = new sql.Request(tx);
		reqRes.input('visita', sql.Int, numeroVisita);
		reqRes.input('fecha', sql.DateTime, now);
		reqRes.input('texto', sql.VarChar(sql.MAX), textoRtf);
		reqRes.input('codOp', sql.Int, codOp);
		reqRes.input('servicio', sql.Char(4), sectorFac);
		reqRes.input('sqlId', sql.Char(36), sqlId);
		const resIns = await reqRes.query(`
			INSERT INTO dbo.imProtocolosResultados (
				NumeroVisita, FechaResultado, FechaCarga, NroProtocolo,
				TextoProtocolo, Estado, CodOperador, ValorServicio, SqlId
			) VALUES (
				@visita, @fecha, @fecha, '',
				@texto, 'N', @codOp, @servicio, @sqlId
			);
			SELECT SCOPE_IDENTITY() AS IdProtocolo;
		`);
		const idProtocolo = Number(resIns.recordset?.[0]?.IdProtocolo) || 0;
		if (idProtocolo <= 0) throw _httpError('No se pudo crear el resultado', 500);

		// Valor es IDENTITY — no insertar Valor explícito (IDENTITY_INSERT OFF).
		const reqInsFac = new sql.Request(tx);
		reqInsFac.input('visita', sql.Int, numeroVisita);
		reqInsFac.input('practica', sql.Int, practica);
		reqInsFac.input('fechaC', sql.Int, fechaClarion);
		reqInsFac.input('horaC', sql.Int, horaClarion);
		reqInsFac.input('sector', sql.VarChar(4), sectorFac);
		reqInsFac.input('codOp', sql.Int, codOp);
		reqInsFac.input('idPac', sql.Int, idPaciente > 0 ? idPaciente : null);
		reqInsFac.input('idProt', sql.Int, idProtocolo);
		const facIns = await reqInsFac.query(`
			INSERT INTO dbo.imFacPracticas (
				Numero, NumeroVisita, TipoPractica, Practica,
				CantidadPractica, FechaPractica, HoraPracticaInicio, HoraPracticaFin,
				ValorSector, FechaPrograma, HoraPrograma, CodOperador,
				FechaGraba, HoraGraba, Factura, Estado, Autorizada, Status,
				NroInforme, NroAutorizacion, IdPaciente, IdProtocolo
			) VALUES (
				0, @visita, 'NO', @practica,
				1, @fechaC, @horaC, 0,
				@sector, @fechaC, @horaC, @codOp,
				@fechaC, @horaC, 0, 2, 2, 0,
				0, '', @idPac, @idProt
			);
			SELECT SCOPE_IDENTITY() AS Valor;
		`);
		const valorFac = Number(facIns.recordset?.[0]?.Valor) || 0;
		if (valorFac <= 0) throw _httpError('No se pudo registrar la práctica', 500);

		const reqProf = new sql.Request(tx);
		reqProf.input('valor', sql.Int, valorFac);
		reqProf.input('mat', sql.Int, matricula);
		reqProf.input('codOp', sql.Int, codOp);
		reqProf.input('fechaC', sql.Int, fechaClarion);
		reqProf.input('horaC', sql.Int, horaClarion);
		await reqProf.query(`
			INSERT INTO dbo.imFacProfesionales (
				Valor, Matricula, Funcion, CodOperador,
				FachaGraba, HoraGraba, Factura, Status
			) VALUES (
				@valor, @mat, 1, @codOp,
				@fechaC, @horaC, 0, 0
			);
		`);

		const reqUpd = new sql.Request(tx);
		reqUpd.input('idProt', sql.Int, idProtocolo);
		reqUpd.input('idPed', sql.Int, id);
		const upd = await reqUpd.query(`
			UPDATE dbo.imPedidosEstudios
			SET IdProtocolo = @idProt
			WHERE IdPedido = @idPed AND (IdProtocolo IS NULL OR IdProtocolo = 0);
			SELECT @@ROWCOUNT AS n;
		`);
		if (Number(upd.recordset?.[0]?.n) !== 1) {
			throw _httpError('No se pudo vincular el resultado al pedido', 409);
		}

		await tx.commit();
		return obtenerPorId(id);
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			/* ignore */
		}
		if (err.statusCode) throw err;
		const e = _httpError(err.message || 'Error al cumplir el pedido', 500);
		throw e;
	}
}

module.exports = {
	crearPedido,
	actualizarPedido,
	eliminarPedido,
	listarPorVisita,
	listarInterconsultasPorVisita,
	listarPendientesPorSector,
	contarLibresPorServicios,
	obtenerPorId,
	tomarPedido,
	liberarPedido,
	cumplirPedido,
	buscarTiposPedidosEstudios,
	listarSectoresReceptor,
	resolverTipoPedidoEstudio,
	plainToRtf,
	rtfToPlain,
	_padSector,
	ensureTomaTable,
};
