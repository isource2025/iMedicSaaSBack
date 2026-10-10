const sharp = require('sharp');
const { executeQuery } = require('../models/db');

/**
 * Firmas digitales (imPersonal.Firma) para incrustar en PDFs generados en el servidor.
 *
 * Cada firmante se busca por la clave que el origen garantiza: `valor` (imPersonal.Valor)
 * o `matricula`. No se cruzan: un número de matrícula puede coincidir con el Valor de
 * otra persona y la firma quedaría atribuida a quien no corresponde.
 */

function clave(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 && v !== 999999 ? Math.trunc(v) : null;
}

function firmaBuffer(raw) {
  if (raw == null) return null;
  if (Buffer.isBuffer(raw)) return raw.length ? raw : null;
  if (raw instanceof Uint8Array) return raw.length ? Buffer.from(raw) : null;
  if (typeof raw === 'object' && Array.isArray(raw.data)) return raw.data.length ? Buffer.from(raw.data) : null;
  return null;
}

/** pdfkit solo dibuja PNG/JPEG: se normaliza a PNG con fondo blanco. */
async function aPng(buf) {
  try {
    return await sharp(buf).flatten({ background: '#ffffff' }).png().toBuffer();
  } catch {
    return null;
  }
}

async function leerFirma(columna, valor) {
  const rows = await executeQuery(
    `SELECT TOP 1 p.Firma
       FROM dbo.imPersonal p
      WHERE p.${columna} = @param0 AND p.Firma IS NOT NULL
      ORDER BY p.Valor`,
    [{ value: valor, type: 'Int' }],
  );
  const buf = firmaBuffer(rows?.[0]?.Firma);
  return buf ? aPng(buf) : null;
}

/** Clave estable de un firmante para el mapa de firmas resueltas. */
function claveFirmante(f) {
  if (!f) return null;
  const v = clave(f.valor);
  if (v) return `v:${v}`;
  const m = clave(f.matricula);
  if (m) return `m:${m}`;
  return null;
}

/**
 * @param {Array<{ valor?: number|string, matricula?: number|string }>} firmantes
 * @returns {Promise<Map<string, Buffer>>} claveFirmante → PNG
 */
async function resolverFirmas(firmantes) {
  const pendientes = new Map();
  for (const f of firmantes || []) {
    const k = claveFirmante(f);
    if (!k || pendientes.has(k)) continue;
    const [tipo, num] = k.split(':');
    pendientes.set(k, { columna: tipo === 'v' ? 'Valor' : 'Matricula', num: Number(num) });
  }

  const out = new Map();
  const items = [...pendientes.entries()];
  const LOTE = 6;
  for (let i = 0; i < items.length; i += LOTE) {
    await Promise.all(
      items.slice(i, i + LOTE).map(async ([k, { columna, num }]) => {
        try {
          const png = await leerFirma(columna, num);
          if (png) out.set(k, png);
        } catch (err) {
          console.warn('[firmasPdf] no se pudo leer firma', k, err?.message || err);
        }
      }),
    );
  }
  return out;
}

module.exports = { resolverFirmas, claveFirmante };
