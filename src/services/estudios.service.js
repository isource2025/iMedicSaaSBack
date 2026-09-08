const crypto = require('crypto');
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');
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

/**
 * Instante para escribir en un DATETIME del HIS. tedious serializa los Date por
 * sus campos UTC, así que la hora argentina va puesta ahí; con un offset -03:00
 * el valor quedaría 3 horas adelantado respecto de lo que graba el escritorio.
 */
function _ahoraWallArgentina() {
	const { fecha, hora } = partesFechaHoraArgentina(new Date());
	return new Date(`${fecha}T${hora}Z`);
}

/**
 * Los DATETIME del HIS guardan hora de pared argentina, sin zona. tedious los
 * devuelve como Date etiquetado en UTC, así que convertirlo a Argentina resta
 * 3 horas de más: se prefiere el valor que ya formateó SQL Server.
 */
function _fechaHoraArgentina(fechaPedido, isoSql, horaSql) {
	const iso = _txt(isoSql);
	if (iso) return { FechaPedidoISO: iso.slice(0, 10), HoraPedido: _txt(horaSql) };

	const d =
		fechaPedido instanceof Date && !Number.isNaN(fechaPedido.getTime())
			? fechaPedido
			: null;
	if (!d) return { FechaPedidoISO: null, HoraPedido: _txt(horaSql) };
	return {
		FechaPedidoISO: d.toISOString().slice(0, 10),
		HoraPedido: d.toISOString().slice(11, 16),
	};
}

function _txt(value) {
	const s = value == null ? '' : String(value).trim();
	return s === '' ? null : s;
}

/** Edad en años a partir de una fecha ISO (yyyy-mm-dd). */
function _edadDesdeISO(iso) {
	const raw = _txt(iso);
	if (!raw) return null;
	const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
	const hoy = new Date();
	let edad = hoy.getFullYear() - y;
	const cumplioEsteAnio =
		hoy.getMonth() + 1 > m || (hoy.getMonth() + 1 === m && hoy.getDate() >= d);
	if (!cumplioEsteAnio) edad -= 1;
	return edad >= 0 && edad < 130 ? edad : null;
}

/**
 * Catálogo imLocalidades cacheado (valor -> nombre). Se resuelve fuera del SQL
 * de pedidos: la tabla es opcional y el nombre de la columna varía entre
 * instalaciones, así que un problema acá no debe tumbar la bandeja de pedidos.
 */
const _localidadesPorValor = createTenantOnce(async () => {
	let resultado;
	try {
		const cols = await executeQuery(
			`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imLocalidades'`,
		);
		const disponibles = new Set(
			(cols || []).map((c) => String(c.COLUMN_NAME || '').toLowerCase()),
		);
		const columna = ['nombrelocalidad', 'localidad', 'descripcion'].find((c) =>
			disponibles.has(c),
		);
		if (!columna || !disponibles.has('valor')) {
			resultado = new Map();
		} else {
			const rows = await executeQuery(
				`SELECT Valor, LTRIM(RTRIM(ISNULL(${columna}, ''))) AS Nombre FROM dbo.imLocalidades`,
			);
			resultado = new Map(
				(rows || [])
					.filter((r) => r.Valor != null && _txt(r.Nombre))
					.map((r) => [String(r.Valor).trim(), String(r.Nombre).trim()]),
			);
		}
	} catch (e) {
		console.warn('[estudios] no se pudo leer imLocalidades:', e.message || e);
		resultado = new Map();
	}
	return resultado;
});

/** Completa PacienteLocalidad en los pedidos ya mapeados. */
async function _completarLocalidades(pedidos) {
	const lista = pedidos || [];
	if (!lista.some((p) => p && p.PacienteValorLocalidad != null)) return lista;
	const mapa = await _localidadesPorValor();
	if (!mapa.size) return lista;
	for (const p of lista) {
		if (p && p.PacienteValorLocalidad != null) {
			p.PacienteLocalidad = mapa.get(String(p.PacienteValorLocalidad).trim()) || null;
		}
	}
	return lista;
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
		FechaPedido: fh.FechaPedidoISO
			? `${fh.FechaPedidoISO} ${fh.HoraPedido || '00:00'}`
			: null,
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
		// Quién respondió: profesional facturado > quien tomó el pedido > operador que
		// cargó el resultado (este último es el único dato disponible cuando la
		// respuesta se escribió desde iMedic escritorio, que no liga facturación al
		// protocolo).
		MatriculaRealizador: cumplido
			? row.MatriculaRealizador != null
				? Number(row.MatriculaRealizador)
				: matriculaToma != null
					? matriculaToma
					: row.ValorPersonalResultado != null
						? Number(row.ValorPersonalResultado)
						: null
			: null,
		RealizadorNombre: cumplido
			? _txt(row.RealizadorNombre) ||
				_txt(row.NombreToma) ||
				_txt(row.OperadorResultadoNombre)
			: null,
		CodOperadorResultado:
			row.CodOperadorResultado != null ? Number(row.CodOperadorResultado) : null,
		ValorPersonalResultado:
			row.ValorPersonalResultado != null ? Number(row.ValorPersonalResultado) : null,
		CodOperadorToma: row.CodOperadorToma != null ? Number(row.CodOperadorToma) : null,
		Tomado: tomado,
		MatriculaToma: Number.isFinite(matriculaToma) && matriculaToma > 0 ? matriculaToma : null,
		NombreToma: row.NombreToma ? String(row.NombreToma).trim() : null,
		FechaToma: row.FechaToma || null,
		EstadoWorkflow: cumplido ? 'CUMPLIDO' : tomado ? 'TOMADO' : 'PENDIENTE',
		PacienteNombre: row.PacienteNombre ? String(row.PacienteNombre).trim() : null,
		PacienteDocumento:
			row.PacienteDocumento != null && String(row.PacienteDocumento).trim() !== ''
				? String(row.PacienteDocumento).trim()
				: null,
		PacienteTipoDocumento: _txt(row.PacienteTipoDocumento),
		PacienteSexo: row.PacienteSexo ? String(row.PacienteSexo).trim() : null,
		PacienteSexoDescripcion: row.PacienteSexoDescripcion
			? String(row.PacienteSexoDescripcion).trim()
			: null,
		ObraSocial: row.ObraSocial ? String(row.ObraSocial).trim() : null,
		PacienteAfiliado: _txt(row.PacienteAfiliado),
		PacienteNumeroHC: _txt(row.PacienteNumeroHC),
		PacienteDomicilio: _txt(row.PacienteDomicilio),
		PacienteValorLocalidad:
			row.PacienteValorLocalidad != null ? Number(row.PacienteValorLocalidad) : null,
		PacienteLocalidad: null,
		PacienteTelefono: _txt(row.PacienteTelefono),
		PacienteTelefonoAlternativo: _txt(row.PacienteTelefonoAlternativo),
		PacienteEmail: _txt(row.PacienteEmail),
		PacienteFechaNacimiento: _txt(row.PacienteFechaNacimiento),
		PacienteEdad: _edadDesdeISO(row.PacienteFechaNacimiento),
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
  CONVERT(varchar(16), pr.FechaResultado, 120) AS FechaResultado,
  realz.PracticaFacturada,
  realz.Matricula AS MatriculaRealizador,
  realz.RealizadorNombre,
  pr.CodOperador AS CodOperadorResultado,
  opRes.ApellidoNombre AS OperadorResultadoNombre,
  opRes.ValorPersonal AS ValorPersonalResultado,
  toma.Matricula AS MatriculaToma,
  toma.CodOperador AS CodOperadorToma,
  CONVERT(varchar(16), toma.FechaToma, 120) AS FechaToma,
  tomaPer.ApellidoNombre AS NombreToma,
  v.IDPACIENTE AS IdPaciente,
  LTRIM(RTRIM(ISNULL(v.CLASEPACIENTE, ''))) AS ClasePaciente,
  LTRIM(RTRIM(ISNULL(v.TIPOADMISION, ''))) AS TipoAdmision,
  LTRIM(RTRIM(ISNULL(pac.ApellidoyNombre, ''))) AS PacienteNombre,
  pac.NumeroDocumento AS PacienteDocumento,
  LTRIM(RTRIM(ISNULL(pac.TipoDocumento, ''))) AS PacienteTipoDocumento,
  LTRIM(RTRIM(ISNULL(pac.Sexo, ''))) AS PacienteSexo,
  LTRIM(RTRIM(ISNULL(sx.Descripcion, ''))) AS PacienteSexoDescripcion,
  LTRIM(RTRIM(ISNULL(cob.RazonSocial, ''))) AS ObraSocial,
  LTRIM(RTRIM(ISNULL(CAST(pac.NumeroSSN AS VARCHAR(40)), ''))) AS PacienteAfiliado,
  LTRIM(RTRIM(ISNULL(CAST(pac.NumeroHC AS VARCHAR(40)), ''))) AS PacienteNumeroHC,
  LTRIM(RTRIM(ISNULL(pac.Domicilio, ''))) AS PacienteDomicilio,
  pac.ValorLocalidad AS PacienteValorLocalidad,
  LTRIM(RTRIM(ISNULL(CAST(pac.TelefonoParticular AS VARCHAR(40)), ''))) AS PacienteTelefono,
  LTRIM(RTRIM(ISNULL(CAST(pac.TelefonoNegocio AS VARCHAR(40)), ''))) AS PacienteTelefonoAlternativo,
  LTRIM(RTRIM(ISNULL(pac.Mail, ''))) AS PacienteEmail,
  CASE
    WHEN pac.FechaNacimiento IS NULL OR pac.FechaNacimiento <= 0 OR pac.FechaNacimiento > 1000000 THEN NULL
    ELSE CONVERT(varchar(10), DATEADD(day, pac.FechaNacimiento, '1800-12-28'), 23)
  END AS PacienteFechaNacimiento,
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
  OUTER APPLY (
    SELECT TOP 1
      fac.Practica AS PracticaFacturada,
      fprof.Matricula,
      LTRIM(RTRIM(ISNULL(realiz.ApellidoNombre, ''))) AS RealizadorNombre
    FROM dbo.imFacPracticas fac
    INNER JOIN dbo.imFacProfesionales fprof ON fprof.Valor = fac.Valor AND fprof.Funcion = 1
    LEFT JOIN dbo.imPersonal realiz ON realiz.Valor = fprof.Matricula
    WHERE pe.IdProtocolo > 0 AND fac.IdProtocolo = pe.IdProtocolo
    ORDER BY
      CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(realiz.ApellidoNombre, ''))), '') IS NOT NULL THEN 0 ELSE 1 END,
      fprof.IDFacProfesional
  ) realz
  OUTER APPLY (
    SELECT TOP 1 op.ApellidoNombre, op.ValorPersonal
    FROM (
      SELECT
        LTRIM(RTRIM(ISNULL(per.ApellidoNombre, ''))) AS ApellidoNombre,
        per.Valor AS ValorPersonal,
        0 AS Ord
      FROM dbo.imPassword pw
      INNER JOIN dbo.imPersonal per ON per.Valor = pw.ValorPersonal
      WHERE pw.CodOperador = pr.CodOperador
      UNION ALL
      SELECT
        LTRIM(RTRIM(
          LTRIM(RTRIM(ISNULL(pw2.Apellido, ''))) +
          CASE
            WHEN LTRIM(RTRIM(ISNULL(pw2.Nombres, ''))) = '' THEN ''
            ELSE ' ' + LTRIM(RTRIM(pw2.Nombres))
          END
        )),
        pw2.ValorPersonal,
        1
      FROM dbo.imPassword pw2
      WHERE pw2.CodOperador = pr.CodOperador
      UNION ALL
      SELECT LTRIM(RTRIM(ISNULL(per3.ApellidoNombre, ''))), per3.Valor, 2
      FROM dbo.imPersonal per3
      WHERE per3.Valor = pr.CodOperador
    ) op
    WHERE pe.IdProtocolo > 0
      AND ISNULL(pr.CodOperador, 0) <> 0
      AND NULLIF(op.ApellidoNombre, '') IS NOT NULL
    ORDER BY op.Ord
  ) opRes
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

/** Tabla SaaS: un solo operador puede tomar un pedido (PK = IdPedido). */
const ensureTomaTable = createTenantOnce(async () => {
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
});

async function _obtenerToma(idPedido) {
	await ensureTomaTable();
	const rows = await executeQuery(
		`SELECT TOP 1 t.IdPedido, t.Matricula, t.CodOperador, t.FechaToma,
		        p.ApellidoNombre AS Nombre, p.Valor AS ValorPersonal
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

function _mapSectoresRows(rows) {
	return (rows || [])
		.map((r) => ({
			valor: String(r.valor || '').trim(),
			descripcion: String(r.descripcion || '').trim(),
			valorServicio: String(r.valorServicio || '').trim(),
			descripcionServicio: String(r.descripcionServicio || '').trim(),
			prefijos: String(r.prefijosPractica || '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		}))
		.filter((s) => s.valor);
}

/** Destinos de pedidos = servicios (imServicios). valor = código de servicio. */
function _mapServiciosReceptor(rows) {
	return (rows || [])
		.map((r) => {
			const valor = String(r.valor || '').trim();
			const descripcion = String(r.descripcion || '').trim() || valor;
			return {
				valor,
				descripcion,
				valorServicio: valor,
				descripcionServicio: descripcion,
				prefijos: String(r.prefijosPractica || '')
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
			};
		})
		.filter((s) => s.valor);
}

function _codigosPedidoDeSector(item) {
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
	add(item?.valor);
	add(item?.valorServicio);
	return out;
}

async function _queryPrimeraOk(candidates, params = []) {
	let last = null;
	for (const sqlText of candidates) {
		try {
			return await executeQuery(sqlText, params);
		} catch (err) {
			last = err;
		}
	}
	if (last) throw last;
	return [];
}

const _SEL_SECTOR = `
		  RTRIM(LTRIM(CAST(s.Valor AS VARCHAR(50)))) AS valor,
		  RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion,
		  RTRIM(LTRIM(CAST(ISNULL(s.ValorServicio, '') AS VARCHAR(50)))) AS valorServicio,
		  RTRIM(LTRIM(CAST(ISNULL(srv.Descripcion, '') AS VARCHAR(200)))) AS descripcionServicio,
		  RTRIM(LTRIM(ISNULL(srv.PrefijosPractica, ''))) AS prefijosPractica`;

const _SEL_SECTOR_SIN_PREF = `
		  RTRIM(LTRIM(CAST(s.Valor AS VARCHAR(50)))) AS valor,
		  RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion,
		  RTRIM(LTRIM(CAST(ISNULL(s.ValorServicio, '') AS VARCHAR(50)))) AS valorServicio,
		  RTRIM(LTRIM(CAST(ISNULL(srv.Descripcion, '') AS VARCHAR(200)))) AS descripcionServicio,
		  '' AS prefijosPractica`;

const _SEL_SECTOR_MIN = `
		  RTRIM(LTRIM(CAST(s.Valor AS VARCHAR(50)))) AS valor,
		  RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion,
		  '' AS valorServicio,
		  '' AS descripcionServicio,
		  '' AS prefijosPractica`;

async function _catalogoSectoresSql() {
	const joinSrv =
		` LEFT JOIN dbo.imServicios srv
		     ON LTRIM(RTRIM(CAST(srv.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(s.ValorServicio AS VARCHAR(50))))`;
	const where = ` WHERE LTRIM(RTRIM(ISNULL(s.Valor, ''))) <> '' ORDER BY s.Descripcion`;
	try {
		return await _queryPrimeraOk([
			`SELECT ${_SEL_SECTOR} FROM dbo.imSectores s ${joinSrv} ${where}`,
			`SELECT ${_SEL_SECTOR_SIN_PREF} FROM dbo.imSectores s ${joinSrv} ${where}`,
			`SELECT ${_SEL_SECTOR_MIN} FROM dbo.imSectores s ${where}`,
		]);
	} catch {
		return [];
	}
}

async function _sectoresAsignadosSql(vp) {
	const joinS =
		` FROM dbo.imPersonalSectores ps
		   LEFT JOIN dbo.imSectores s
		     ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(ps.idSector AS VARCHAR(50))))`;
	const joinSrv =
		` LEFT JOIN dbo.imServicios srv
		     ON LTRIM(RTRIM(CAST(srv.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(s.ValorServicio AS VARCHAR(50))))`;
	const where = ` WHERE ps.idPersonal = @p0
		 ORDER BY ISNULL(NULLIF(LTRIM(RTRIM(s.Descripcion)), ''), ps.idSector)`;
	const params = [{ value: vp, type: 'Int' }];
	try {
		const rows = await _queryPrimeraOk(
			[
				`SELECT RTRIM(LTRIM(CAST(ps.idSector AS VARCHAR(50)))) AS valor,
				        RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion,
				        RTRIM(LTRIM(CAST(ISNULL(s.ValorServicio, '') AS VARCHAR(50)))) AS valorServicio,
				        RTRIM(LTRIM(CAST(ISNULL(srv.Descripcion, '') AS VARCHAR(200)))) AS descripcionServicio,
				        RTRIM(LTRIM(ISNULL(srv.PrefijosPractica, ''))) AS prefijosPractica
				 ${joinS} ${joinSrv} ${where}`,
				`SELECT RTRIM(LTRIM(CAST(ps.idSector AS VARCHAR(50)))) AS valor,
				        RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion,
				        RTRIM(LTRIM(CAST(ISNULL(s.ValorServicio, '') AS VARCHAR(50)))) AS valorServicio,
				        RTRIM(LTRIM(CAST(ISNULL(srv.Descripcion, '') AS VARCHAR(200)))) AS descripcionServicio,
				        '' AS prefijosPractica
				 ${joinS} ${joinSrv} ${where}`,
				`SELECT RTRIM(LTRIM(CAST(ps.idSector AS VARCHAR(50)))) AS valor,
				        RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion,
				        '' AS valorServicio,
				        '' AS descripcionServicio,
				        '' AS prefijosPractica
				 ${joinS} ${where}`,
			],
			params,
		);
		return rows || [];
	} catch {
		return [];
	}
}

async function _sectoresAsignadosNube(vp) {
	try {
		const { getTenantId } = require('../context/tenantContext');
		const tid = Number(getTenantId());
		if (!Number.isFinite(tid) || tid <= 0) return [];
		const nube = require('./nubeTenant.service');
		const items = await nube.listarSectoresDeUsuario(tid, vp);
		return (items || [])
			.map((s) => ({
				valor: String(s.id || s.valor || '').trim(),
				descripcion: String(s.descripcion || '').trim(),
				valorServicio: '',
				descripcionServicio: '',
				prefijosPractica: '',
			}))
			.filter((s) => s.valor);
	} catch {
		return [];
	}
}

function _enrichConCatalogo(asignados, catalogo) {
	const byVal = new Map();
	for (const c of catalogo || []) {
		const k = String(c.valor || '').trim().toUpperCase();
		if (k) byVal.set(k, c);
	}
	return (asignados || []).map((a) => {
		const hit = byVal.get(String(a.valor || '').trim().toUpperCase());
		if (!hit) return a;
		return {
			valor: a.valor,
			descripcion: a.descripcion || hit.descripcion,
			valorServicio: a.valorServicio || hit.valorServicio,
			descripcionServicio: a.descripcionServicio || hit.descripcionServicio,
			prefijosPractica: a.prefijosPractica || hit.prefijosPractica,
		};
	});
}

/**
 * Destinos a los que se SOLICITAN estudios/interconsultas = SERVICIOS (imServicios).
 * No listar sectores: IdSectorReceptor guarda el código de servicio.
 */
async function listarSectoresReceptor({ valorPersonal } = {}) {
	const personalServicios = require('./personalServicios.service');
	const vp = Number(valorPersonal);
	if (Number.isFinite(vp) && vp > 0) {
		return _mapServiciosReceptor(await personalServicios.listarParaBandeja(vp));
	}
	return _mapServiciosReceptor(await personalServicios.listarCatalogoPedidos());
}

async function contarLibresPorServicios({ valorPersonal, sectoresSesion } = {}) {
	await ensureTomaTable();
	const sectores = Array.isArray(sectoresSesion) && sectoresSesion.length
		? sectoresSesion
		: await listarSectoresReceptor({ valorPersonal });
	const baseCodes = [...new Set(sectores.flatMap((s) => _codigosPedidoDeSector(s)))].filter(Boolean);
	const codes = [];
	const seen = new Set();
	for (const c of baseCodes) {
		for (const x of await expandCodigosReceptor(c)) {
			const k = String(x).trim().toUpperCase();
			if (!k || seen.has(k)) continue;
			seen.add(k);
			codes.push(x);
		}
	}
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

	const keysByServicio = new Map();
	for (const s of sectores) {
		const expanded = new Set();
		for (const c of _codigosPedidoDeSector(s)) {
			for (const x of await expandCodigosReceptor(c)) {
				const k = String(x || '').trim().toUpperCase();
				if (k) expanded.add(k);
			}
		}
		keysByServicio.set(s.valor, expanded);
	}

	const porServicio = sectores
		.map((s) => {
			const keys = keysByServicio.get(s.valor) || new Set();
			let estudios = 0;
			let interconsultas = 0;
			let urgentes = 0;
			for (const [key, hit] of byCode) {
				if (!keys.has(key)) continue;
				estudios += hit.estudios;
				interconsultas += hit.interconsultas;
				urgentes += hit.urgentes;
			}
			return {
				valor: s.valor,
				descripcion: s.descripcion || s.valor,
				valorServicio: s.valorServicio || '',
				descripcionServicio: s.descripcionServicio || '',
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
 * Códigos con los que puede estar grabado IdSectorReceptor:
 * - código de servicio (destino correcto)
 * - códigos de sector ligados por ValorServicio (legado)
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
		const asSector = await executeQuery(
			`SELECT TOP 1 RTRIM(LTRIM(CAST(ISNULL(ValorServicio, '') AS VARCHAR(50)))) AS valorServicio
			 FROM dbo.imSectores
			 WHERE UPPER(LTRIM(RTRIM(CAST(Valor AS VARCHAR(50))))) = UPPER(LTRIM(RTRIM(@p0)))`,
			[{ value: raw, type: 'VarChar' }],
		);
		add(asSector?.[0]?.valorServicio);
	} catch {
		/* sin ValorServicio */
	}
	try {
		const sectoresDelServicio = await executeQuery(
			`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor
			 FROM dbo.imSectores
			 WHERE UPPER(LTRIM(RTRIM(CAST(ISNULL(ValorServicio, '') AS VARCHAR(50))))) = UPPER(LTRIM(RTRIM(@p0)))
			    OR LEFT(UPPER(LTRIM(RTRIM(CAST(ISNULL(ValorServicio, '') AS VARCHAR(50))))) + '    ', 4)
			       = LEFT(UPPER(LTRIM(RTRIM(@p0))) + '    ', 4)`,
			[{ value: raw, type: 'VarChar' }],
		);
		for (const r of sectoresDelServicio || []) add(r.valor);
	} catch {
		/* sin imSectores.ValorServicio */
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
		throw _httpError('El servicio destino es obligatorio');
	}

	const tipo = await resolverTipoPedidoEstudio(idTipoPedido, idPractica);
	const codPractica = Number(tipo.IdPractica) || 0;
	if (codPractica <= 0) {
		throw _httpError(`Práctica inválida para pedido ${tipo.IdTipoPedido}`);
	}

	const urgRaw = String(estadoUrgencia || 'Normal').trim();
	const urgencia = ['Normal', 'Urgente', 'Medio'].includes(urgRaw) ? urgRaw : 'Normal';
	const now =
		fechaPedido instanceof Date && !Number.isNaN(fechaPedido.getTime())
			? fechaPedido
			: _ahoraWallArgentina();

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

	// Campanita: avisar a profesionales del servicio destino (imPersonalServicios).
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
		console.warn('[estudios] notif servicio omitida:', err.message || err);
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

/** Solo el creador. Usado para editar solicitud (motivo) en cualquier estado. */
async function _assertPedidoDelCreador(idPedido, sesion) {
	const ped = await obtenerPorId(idPedido);
	if (!ped) throw _httpError('Pedido no encontrado', 404);
	const autor = Number(ped.MatriculaSolicitante);
	const ids = _idsAutorSesion(sesion || {});
	if (!Number.isFinite(autor) || autor <= 0 || !ids.includes(autor)) {
		throw _httpError('Solo quien solicitó el pedido puede modificarlo.', 403);
	}
	return ped;
}

/** Pendiente = sin toma y sin resultado. Tomado/respondido: no se elimina. */
async function _assertPedidoPendienteDelCreador(idPedido, sesion) {
	const ped = await _assertPedidoDelCreador(idPedido, sesion);
	if (ped.Cumplido || Number(ped.IdProtocolo) > 0) {
		throw _httpError('El pedido ya fue respondido. Solo se puede visualizar.', 409);
	}
	if (ped.Tomado) {
		throw _httpError('El pedido ya fue tomado. Solo se puede visualizar.', 409);
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
	const ped = await _assertPedidoDelCreador(id, { matricula, valorPersonal, codOperador });

	const urgRaw = String(estadoUrgencia || ped.EstadoUrgencia || 'Normal').trim();
	const urgencia = ['Normal', 'Urgente', 'Medio'].includes(urgRaw) ? urgRaw : 'Normal';
	const notasFinal = notas != null ? _s(notas, 5000) : _s(ped.NotasObservacion, 5000);

	const bloqueado = !!(ped.Cumplido || Number(ped.IdProtocolo) > 0 || ped.Tomado);
	if (bloqueado) {
		// Ya tomado/respondido: solo el motivo/notas y la urgencia del solicitante.
		await executeQuery(
			`UPDATE dbo.imPedidosEstudios
			 SET NotasObservacion = @p1,
			     EstadoUrgencia = @p2
			 WHERE IdPedido = @p0`,
			[
				{ value: id, type: 'Int' },
				{ value: notasFinal, type: 'VarChar' },
				{ value: urgencia, type: 'VarChar' },
			],
		);
		return obtenerPorId(id);
	}

	if (!String(idSectorReceptor || '').trim()) {
		throw _httpError('El servicio destino es obligatorio');
	}
	const tipo = await resolverTipoPedidoEstudio(idTipoPedido, idPractica);
	const codPractica = Number(tipo.IdPractica) || 0;
	if (codPractica <= 0) {
		throw _httpError(`Práctica inválida para pedido ${tipo.IdTipoPedido}`);
	}

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
			{ value: notasFinal, type: 'VarChar' },
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
	try {
		const notificacionesService = require('./notificaciones.service');
		await notificacionesService.eliminarPorEntidadPedido(id);
	} catch (err) {
		console.warn('[estudios] cleanup notif pedido:', err.message || err);
	}
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
	return _completarLocalidades(dedupePedidos((rows || []).map(mapPedidoRow)));
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
	return _completarLocalidades((rows || []).map(mapPedidoRow));
}

async function listarPendientesPorSector(sectorReceptor, opts = {}) {
	await ensureTomaTable();
	let codes = Array.isArray(opts.codigos)
		? [...new Set(opts.codigos.map((c) => String(c || '').trim()).filter(Boolean))]
		: [];
	if (!codes.length) {
		codes = await expandCodigosReceptor(sectorReceptor);
	}
	if (!codes.length) {
		if (opts.permitirVacio) return [];
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
	return _completarLocalidades(dedupePedidos((rows || []).map(mapPedidoRow)));
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
	const [pedido] = await _completarLocalidades([mapPedidoRow(rows[0])]);
	return pedido;
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
	try {
		const notificacionesService = require('./notificaciones.service');
		await notificacionesService.eliminarPorEntidadPedido(id);
	} catch (err) {
		console.warn('[estudios] cleanup notif toma:', err.message || err);
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
 * Facturación: imFacProfesionales.Matricula = Valor de imPersonal de la toma.
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
	/**
	 * Quien cobra en facturación = quien tomó el pedido.
	 * imFacProfesionales.Matricula guarda el Valor de imPersonal (no la matrícula):
	 * así lo lee iMedic escritorio y así lo escribe protocolos.service.
	 */
	const matricula = Number(toma.ValorPersonal) || Number(toma.Matricula);

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
	const fechaWall = _ahoraWallArgentina();
	const textoRtf = plainToRtf(texto);
	const sqlId = crypto.randomUUID().toUpperCase();

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	try {
		const reqRes = new sql.Request(tx);
		reqRes.input('visita', sql.Int, numeroVisita);
		reqRes.input('fecha', sql.DateTime, fechaWall);
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
		try {
			const notificacionesService = require('./notificaciones.service');
			await notificacionesService.eliminarPorEntidadPedido(id);
		} catch (err) {
			console.warn('[estudios] cleanup notif cumplir:', err.message || err);
		}
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

function _idsResultado(ped, toma, protoCodOperador) {
	const ids = [];
	const push = (v) => {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
	};
	push(ped?.MatriculaRealizador);
	push(ped?.MatriculaToma);
	push(ped?.ValorPersonalResultado);
	push(ped?.CodOperadorResultado);
	push(ped?.CodOperadorToma);
	push(toma?.Matricula);
	push(toma?.CodOperador);
	push(protoCodOperador);
	return ids;
}

async function _assertResultadoDelRealizador(idPedido, sesion) {
	const ped = await obtenerPorId(idPedido);
	if (!ped) throw _httpError('Pedido no encontrado', 404);
	if (!ped.Cumplido || !(Number(ped.IdProtocolo) > 0)) {
		throw _httpError('Solo se puede editar un estudio o interconsulta ya respondido', 409);
	}
	const idsSesion = _idsAutorSesion(sesion || {});
	if (!idsSesion.length) {
		throw _httpError('No se pudo resolver la identidad del operador', 400);
	}
	const toma = await _obtenerToma(idPedido);
	let protoCod = null;
	try {
		const proto = await executeQuery(
			`SELECT TOP 1 CodOperador FROM dbo.imProtocolosResultados WHERE IdProtocolo = @p0`,
			[{ value: Number(ped.IdProtocolo), type: 'Int' }],
		);
		protoCod = proto?.[0]?.CodOperador;
	} catch {
		/* columna opcional */
	}
	const autores = _idsResultado(ped, toma, protoCod);
	if (!autores.some((a) => idsSesion.includes(a))) {
		throw _httpError('Solo quien respondió el pedido puede editar el resultado', 403);
	}
	return ped;
}

/**
 * Edita el texto del resultado ya cumplido. Solo quien dio la respuesta.
 * No recrea facturación ni cambia la fecha original del informe.
 */
async function actualizarResultado({
	idPedido,
	textoInforme,
	matricula,
	valorPersonal,
	codOperador,
}) {
	const texto = String(textoInforme || '').trim();
	if (!texto) throw _httpError('El informe / resultado es obligatorio');

	const ped = await _assertResultadoDelRealizador(idPedido, {
		matricula,
		valorPersonal,
		codOperador,
	});
	const idProt = Number(ped.IdProtocolo);
	if (!Number.isFinite(idProt) || idProt <= 0) {
		throw _httpError('Pedido sin protocolo de resultado', 409);
	}
	const textoRtf = plainToRtf(texto);

	// VarChar(MAX) explícito: executeQuery con VarChar sin length puede truncar.
	const pool = await getRequestPool();
	const req = pool.request();
	req.input('idProt', sql.Int, idProt);
	req.input('texto', sql.VarChar(sql.MAX), textoRtf);
	const upd = await req.query(`
		UPDATE dbo.imProtocolosResultados
		SET TextoProtocolo = @texto
		WHERE IdProtocolo = @idProt;
		SELECT @@ROWCOUNT AS n;
	`);
	if (Number(upd.recordset?.[0]?.n) !== 1) {
		throw _httpError('No se pudo actualizar el resultado', 409);
	}
	return obtenerPorId(Number(idPedido));
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
	actualizarResultado,
	buscarTiposPedidosEstudios,
	listarSectoresReceptor,
	expandCodigosReceptor,
	resolverTipoPedidoEstudio,
	plainToRtf,
	rtfToPlain,
	_padSector,
	ensureTomaTable,
};
