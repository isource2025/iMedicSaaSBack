const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');

/**
 * ValorPersonal del médico titular de un turno (para notificar adjuntos de agenda).
 */
async function obtenerValorPersonalMedicoTurno(idTurno) {
  const id = Number(idTurno);
  if (!Number.isFinite(id) || id <= 0) return null;
  const rows = await executeQuery(
    `
    SELECT TOP 1 pw.ValorPersonal
    FROM dbo.imTurnos t
    INNER JOIN dbo.imPersonal per ON per.Matricula = t.Profesional
    INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = per.Valor
    WHERE t.IdTurno = @p0
      AND ISNULL(pw.MarcadeBaja, '0') = '0'
    `,
    [{ value: id, type: 'Int' }],
  );
  const vp = rows?.[0]?.ValorPersonal;
  return vp != null && Number(vp) > 0 ? Number(vp) : null;
}

/**
 * Destinatarios para "nuevo adjunto en visita".
 * - Si idTurno: médico del turno (prioridad).
 * - Si NOTIFICACIONES_ADJUNTOS_VALOR_PERSONAL_LIST: lista fija.
 * - Si no: todos los usuarios activos excepto quien subió.
 */
async function obtenerDestinatariosAdjunto(excluirValorPersonal, idTurno) {
  if (idTurno != null && Number(idTurno) > 0) {
    const medicoVp = await obtenerValorPersonalMedicoTurno(idTurno);
    if (medicoVp && medicoVp !== excluirValorPersonal) {
      return [medicoVp];
    }
  }

  const raw = process.env.NOTIFICACIONES_ADJUNTOS_VALOR_PERSONAL_LIST;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n !== excluirValorPersonal);
  }

  const rows = await executeQuery(
    `
    SELECT p.ValorPersonal
    FROM dbo.imPassword p
    WHERE ISNULL(p.MarcadeBaja, 0) = 0
      AND p.ValorPersonal <> @param0
    `,
    [{ value: excluirValorPersonal || 0 }],
  );
  return (rows || []).map((r) => r.ValorPersonal).filter(Boolean);
}

/**
 * Crea notificaciones por adjunto (no bloquea el upload si falla).
 */
async function notificarNuevoAdjunto({
  numeroVisita,
  idTurno,
  idAdjunto,
  nombreArchivo,
  valorPersonalUploader,
}) {
  try {
    const destinatarios = await obtenerDestinatariosAdjunto(valorPersonalUploader, idTurno);
    if (!destinatarios.length) {
      console.log('[notif adjuntos] Sin destinatarios configurados o activos.');
      return;
    }

    const ref =
      idTurno && Number(idTurno) > 0
        ? `turno ${idTurno}`
        : `visita ${numeroVisita}`;
    const descripcion = `Nuevo adjunto: ${nombreArchivo} (${ref})`.substring(0, 250);
    const datos = {
      numeroVisita: numeroVisita || 0,
      idTurno: idTurno || null,
      idAdjunto,
      nombreArchivo,
    };

    for (const vp of destinatarios) {
      await notificacionesService.crear({
        valorPersonal: vp,
        tipo: 'ADJUNTO_VISITA',
        descripcion,
        entidadTipo: 'ADJUNTO',
        entidadId: idAdjunto,
        datos,
      });
    }
    console.log(
      `[notif adjuntos] ${destinatarios.length} notificación(es) para adjunto ${idAdjunto} ${ref}`,
    );
  } catch (e) {
    console.warn('[notif adjuntos] No crítico —', e.message);
  }
}

module.exports = {
  notificarNuevoAdjunto,
  obtenerDestinatariosAdjunto,
  obtenerValorPersonalMedicoTurno,
};
