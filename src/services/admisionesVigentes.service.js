/**
 * Admisiones vigentes: pacientes con cama ocupada y sin egreso, para el
 * recorrido de sala. Una fila por cama, ordenada por sector y cama.
 */
const { executeQuery } = require('../models/db');
const { repararTextoClarionAnsi } = require('../utils/clarionText');

const MS_DIA = 24 * 60 * 60 * 1000;
const CLARION_EPOCH = Date.UTC(1800, 11, 28);

function texto(v) {
	return v == null ? '' : repararTextoClarionAnsi(String(v).trim());
}

function edadDesdeClarion(fechaNacimiento, hoy = new Date()) {
	const n = Number(fechaNacimiento);
	if (!Number.isFinite(n) || n <= 0) return null;
	const nac = new Date(CLARION_EPOCH + n * MS_DIA);
	let edad = hoy.getUTCFullYear() - nac.getUTCFullYear();
	const m = hoy.getUTCMonth() - nac.getUTCMonth();
	if (m < 0 || (m === 0 && hoy.getUTCDate() < nac.getUTCDate())) edad -= 1;
	return edad >= 0 && edad < 130 ? edad : null;
}

/** @param {{ sector?: string }} filtros */
async function listar({ sector } = {}) {
	const s = String(sector || '').trim();
	const params = s ? [{ value: s, type: 'VarChar' }] : [];
	const rows = await executeQuery(
		`
		SELECT
			v.NumeroVisita,
			v.IdPaciente,
			LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS Paciente,
			LTRIM(RTRIM(CAST(ISNULL(p.NumeroDocumento, '') AS VARCHAR(20)))) AS Documento,
			LTRIM(RTRIM(CAST(ISNULL(p.NumeroHC, '') AS VARCHAR(20)))) AS NumeroHC,
			p.FechaNacimiento,
			LTRIM(RTRIM(ISNULL(sx.Descripcion, ISNULL(p.Sexo, '')))) AS Sexo,
			CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaIngreso,
			CONVERT(VARCHAR(5), v.FECHAADMISIONS, 114) AS HoraIngreso,
			DATEDIFF(DAY, v.FECHAADMISIONS, GETDATE()) AS DiasInternacion,
			LTRIM(RTRIM(ISNULL(d.Descripcion, ISNULL(CAST(v.Diagnostico AS VARCHAR(20)), '')))) AS Diagnostico,
			LTRIM(RTRIM(ISNULL(c.RazonSocial, ''))) AS Cobertura,
			LTRIM(RTRIM(ISNULL(prof.ApellidoNombre, ''))) AS Medico,
			LTRIM(RTRIM(CAST(hc.ValorSector AS VARCHAR(50)))) AS Sector,
			LTRIM(RTRIM(ISNULL(sec.Descripcion, ''))) AS SectorDescripcion,
			LTRIM(RTRIM(CAST(hc.ValorHabitacionCama AS VARCHAR(50)))) AS Cama
		FROM dbo.imHabitacionCamas hc WITH (NOLOCK)
		INNER JOIN dbo.imVisita v WITH (NOLOCK) ON v.NumeroVisita = hc.NumeroVisita
		INNER JOIN dbo.imPacientes p WITH (NOLOCK) ON p.IdPaciente = v.IdPaciente
		LEFT JOIN dbo.imSexo sx WITH (NOLOCK) ON sx.Valor = p.Sexo
		LEFT JOIN dbo.imDiagnosticos d WITH (NOLOCK) ON d.CodigoOMS = v.Diagnostico
		LEFT JOIN dbo.imClientes c WITH (NOLOCK) ON c.Valor = v.Cliente
		LEFT JOIN dbo.imSectores sec WITH (NOLOCK)
			ON LTRIM(RTRIM(sec.Valor)) = LTRIM(RTRIM(CAST(hc.ValorSector AS VARCHAR(50))))
		OUTER APPLY (
			SELECT TOP 1 pe.ApellidoNombre
			FROM dbo.imPersonal pe WITH (NOLOCK)
			WHERE ISNULL(TRY_CAST(v.DOCTORADMISOR AS INT), 0) > 0
			  AND pe.Matricula = TRY_CAST(v.DOCTORADMISOR AS INT)
		) prof
		WHERE TRY_CAST(hc.NumeroVisita AS INT) > 0
		  AND ISNULL(TRY_CAST(v.FechaEgreso AS INT), 0) = 0
		  ${s ? 'AND LTRIM(RTRIM(CAST(hc.ValorSector AS VARCHAR(50)))) = @p0' : ''}
		ORDER BY sec.Descripcion, hc.ValorSector, hc.ValorHabitacionCama
		`,
		params,
	);

	const hoy = new Date();
	return (rows || []).map((r) => ({
		numeroVisita: Number(r.NumeroVisita) || 0,
		idPaciente: Number(r.IdPaciente) || null,
		paciente: texto(r.Paciente),
		documento: texto(r.Documento) || null,
		numeroHC: texto(r.NumeroHC) || null,
		edad: edadDesdeClarion(r.FechaNacimiento, hoy),
		sexo: texto(r.Sexo) || null,
		fechaIngreso: r.FechaIngreso || null,
		horaIngreso: r.HoraIngreso || null,
		diasInternacion: Number.isFinite(Number(r.DiasInternacion)) ? Number(r.DiasInternacion) : null,
		diagnostico: texto(r.Diagnostico) || null,
		cobertura: texto(r.Cobertura) || null,
		medico: texto(r.Medico) || null,
		sector: texto(r.Sector) || null,
		sectorDescripcion: texto(r.SectorDescripcion) || null,
		cama: texto(r.Cama) || null,
	}));
}

module.exports = { listar, edadDesdeClarion };
