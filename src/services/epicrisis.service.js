/**
 * Epicrisis clínica — tabla dbo.imHCEpicrisis
 *
 * Notas de esquema (auditado):
 * - Fecha es date SQL (no Clarion INT, a diferencia de imHCEvolucion.FechaEv)
 * - Hora es Clarion TIME (int)
 * - Epicrisis / DiagnosticoText: varchar(8000)
 * - Diagnostico: varchar(8) (código CIE corto)
 * - Profecional: matrícula (int)
 */
const { executeQuery } = require('../models/db');
const { convertirHoraAClarion } = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');
const { asegurarDisclaimerEnTexto } = require('./epicrisisIa.service');

const MAX_EPICRISIS = 8000;
const MAX_DIAG_TEXT = 8000;
const MAX_DIAG_CODE = 8;

function clip(str, max) {
	const s = String(str ?? '');
	return s.length > max ? s.slice(0, max) : s;
}

function padSector(idSector) {
	const s = String(idSector ?? '').trim();
	if (!s) return null;
	return s.length >= 4 ? s.slice(0, 4) : s.padEnd(4, ' ');
}

function toFechaSql(fecha) {
	if (!fecha) return null;
	const s = String(fecha).slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		throw new Error('Fecha inválida (esperado YYYY-MM-DD)');
	}
	return s;
}

const SELECT_BASE = `
  SELECT
    ep.IdHCEpicrisis,
    ep.IdVisita,
    ep.NroHC,
    CONVERT(varchar(10), ep.Fecha, 23) AS Fecha,
    CONVERT(varchar(5), DATEADD(ms, (ISNULL(ep.Hora, 1) - 1) * 10, 0), 108) AS Hora,
    RTRIM(LTRIM(ep.IdSector)) AS IdSector,
    sec.Descripcion AS SectorDescripcion,
    ep.Profecional,
    per.ApellidoNombre AS ProfesionalNombreCompleto,
    ep.Epicrisis,
    ep.NumeroDocumento,
    RTRIM(LTRIM(ep.Diagnostico)) AS Diagnostico,
    ep.DiagnosticoText
  FROM dbo.imHCEpicrisis AS ep
  LEFT JOIN dbo.imSectores AS sec ON ep.IdSector = sec.Valor
  LEFT JOIN dbo.imPersonal AS per ON ep.Profecional = per.Matricula
`;

async function listarPorVisita(idVisita) {
	const sql = `
    ${SELECT_BASE}
    WHERE ep.IdVisita = @param0
    ORDER BY ep.Fecha DESC, ep.Hora DESC, ep.IdHCEpicrisis DESC
  `;
	return executeQuery(sql, [{ value: Number(idVisita) }]);
}

async function obtenerPorId(id) {
	const sql = `
    ${SELECT_BASE}
    WHERE ep.IdHCEpicrisis = @param0
  `;
	const rows = await executeQuery(sql, [{ value: Number(id) }]);
	return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function crear(data) {
	const fecha = toFechaSql(data.Fecha);
	const hora = convertirHoraAClarion(data.Hora);
	const generadoConIA = Boolean(data.GeneradoConIA);
	const epicrisis = clip(
		normalizarTextoParaClarionAnsi(
			asegurarDisclaimerEnTexto(data.Epicrisis, generadoConIA),
		),
		MAX_EPICRISIS,
	);
	const diagnostico = data.Diagnostico
		? clip(String(data.Diagnostico).trim().toUpperCase(), MAX_DIAG_CODE)
		: null;
	const diagnosticoText = data.DiagnosticoText
		? clip(normalizarTextoParaClarionAnsi(data.DiagnosticoText), MAX_DIAG_TEXT)
		: null;

	const sql = `
    INSERT INTO dbo.imHCEpicrisis (
      IdVisita,
      NroHC,
      Fecha,
      Hora,
      IdSector,
      Profecional,
      Epicrisis,
      NumeroDocumento,
      Diagnostico,
      DiagnosticoText
    ) VALUES (
      @param0,
      COALESCE(
        (SELECT TRY_CAST(p.NumeroHC AS INT)
         FROM dbo.imVisita v
         INNER JOIN dbo.imPacientes p ON v.IdPaciente = p.IdPaciente
         WHERE v.NumeroVisita = @param0),
        0
      ),
      @param1,
      @param2,
      @param3,
      @param4,
      @param5,
      @param6,
      @param7,
      @param8
    );
    SELECT SCOPE_IDENTITY() AS IdHCEpicrisis;
  `;

	const params = [
		{ value: Number(data.IdVisita) },
		{ value: fecha },
		{ value: hora },
		{ value: padSector(data.IdSector) },
		{ value: data.Profecional != null ? Number(data.Profecional) : null },
		{ value: epicrisis },
		{ value: data.NumeroDocumento != null ? Number(data.NumeroDocumento) : null },
		{ value: diagnostico },
		{ value: diagnosticoText },
	];

	const result = await executeQuery(sql, params);
	return result?.[0] || null;
}

async function actualizar(id, data) {
	const fecha = toFechaSql(data.Fecha);
	const hora = convertirHoraAClarion(data.Hora);
	const generadoConIA = Boolean(data.GeneradoConIA);
	const epicrisis = clip(
		normalizarTextoParaClarionAnsi(
			asegurarDisclaimerEnTexto(data.Epicrisis, generadoConIA),
		),
		MAX_EPICRISIS,
	);
	const diagnostico = data.Diagnostico
		? clip(String(data.Diagnostico).trim().toUpperCase(), MAX_DIAG_CODE)
		: null;
	const diagnosticoText = data.DiagnosticoText
		? clip(normalizarTextoParaClarionAnsi(data.DiagnosticoText), MAX_DIAG_TEXT)
		: null;

	const sql = `
    UPDATE dbo.imHCEpicrisis
    SET
      Fecha = @param1,
      Hora = @param2,
      IdSector = @param3,
      Epicrisis = @param4,
      NumeroDocumento = @param5,
      Diagnostico = @param6,
      DiagnosticoText = @param7
    WHERE IdHCEpicrisis = @param0
  `;

	await executeQuery(sql, [
		{ value: Number(id) },
		{ value: fecha },
		{ value: hora },
		{ value: padSector(data.IdSector) },
		{ value: epicrisis },
		{ value: data.NumeroDocumento != null ? Number(data.NumeroDocumento) : null },
		{ value: diagnostico },
		{ value: diagnosticoText },
	]);
	return true;
}

async function eliminar(id) {
	await executeQuery(`DELETE FROM dbo.imHCEpicrisis WHERE IdHCEpicrisis = @param0`, [
		{ value: Number(id) },
	]);
	return true;
}

module.exports = {
	listarPorVisita,
	obtenerPorId,
	crear,
	actualizar,
	eliminar,
	MAX_EPICRISIS,
};
