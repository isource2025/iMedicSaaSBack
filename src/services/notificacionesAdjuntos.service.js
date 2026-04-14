const { executeQuery } = require('../models/db');
const notificacionesService = require('./notificaciones.service');

/**
 * Destinatarios para "nuevo adjunto en visita".
 * - Si existe NOTIFICACIONES_ADJUNTOS_VALOR_PERSONAL_LIST (ej. "12,34,56"), solo esos ValorPersonal.
 * - Si no: todos los usuarios activos (MarcadeBaja = 0) excepto quien subió el archivo.
 */
async function obtenerDestinatariosAdjunto(excluirValorPersonal) {
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
    [{ value: excluirValorPersonal || 0 }]
  );
  return (rows || []).map((r) => r.ValorPersonal).filter(Boolean);
}

/**
 * Crea notificaciones por adjunto (no bloquea el upload si falla).
 */
async function notificarNuevoAdjunto({
  numeroVisita,
  idAdjunto,
  nombreArchivo,
  valorPersonalUploader,
}) {
  try {
    const destinatarios = await obtenerDestinatariosAdjunto(valorPersonalUploader);
    if (!destinatarios.length) {
      console.log('[notif adjuntos] Sin destinatarios configurados o activos.');
      return;
    }

    const descripcion = `Nuevo adjunto: ${nombreArchivo} (visita ${numeroVisita})`.substring(0, 250);
    const datos = {
      numeroVisita,
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
      `[notif adjuntos] ${destinatarios.length} notificación(es) para adjunto ${idAdjunto} visita ${numeroVisita}`
    );
  } catch (e) {
    console.warn('[notif adjuntos] No crítico —', e.message);
  }
}

module.exports = {
  notificarNuevoAdjunto,
  obtenerDestinatariosAdjunto,
};
