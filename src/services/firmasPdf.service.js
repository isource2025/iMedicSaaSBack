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

/**
 * BMP sin compresión (1/4/8 bpp con paleta, 24 y 32 bpp) → RGB crudo.
 * Las firmas cargadas desde el sistema Clarion son BMP y sharp no los decodifica.
 */
function decodificarBmp(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const offset = buf.readUInt32LE(10);
  const dib = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const rawH = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compr = dib >= 40 ? buf.readUInt32LE(30) : 0;
  const height = Math.abs(rawH);
  if (width <= 0 || !height || ![1, 4, 8, 24, 32].includes(bpp)) return null;
  if (compr !== 0 && !(compr === 3 && bpp === 32)) return null;

  let paleta = null;
  if (bpp <= 8) {
    const usadas = (dib >= 40 && buf.readUInt32LE(46)) || 1 << bpp;
    paleta = [];
    for (let i = 0; i < usadas; i++) {
      const p = 14 + dib + i * 4;
      if (p + 3 > buf.length) break;
      paleta.push([buf[p + 2], buf[p + 1], buf[p]]);
    }
  }

  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  if (offset + stride * height > buf.length) return null;
  const out = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y++) {
    const fila = offset + (rawH > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (bpp >= 24) {
        const p = fila + x * (bpp / 8);
        out[o] = buf[p + 2];
        out[o + 1] = buf[p + 1];
        out[o + 2] = buf[p];
      } else {
        const bit = x * bpp;
        const idx = (buf[fila + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const c = paleta[idx] || [255, 255, 255];
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
      }
    }
  }
  return { data: out, width, height };
}

/** pdfkit solo dibuja PNG/JPEG: se normaliza a PNG con fondo blanco y tamaño acotado. */
async function aPng(buf) {
  try {
    const bmp = decodificarBmp(buf);
    const img = bmp
      ? sharp(bmp.data, { raw: { width: bmp.width, height: bmp.height, channels: 3 } })
      : sharp(buf).flatten({ background: '#ffffff' });
    return await img.resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
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
