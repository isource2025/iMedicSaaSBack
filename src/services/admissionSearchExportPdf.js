const PDFDocument = require('pdfkit');
const path = require('path');
const { PDFDocument: PDFLibDocument } = require('pdf-lib');
const sharp = require('sharp');
const adjuntosService = require('./adjuntos.service');

const MARGIN = 48;
const SECTION_BG = '#d6eff5';
const SECTION_BORDER = '#5eb8cc';
const TZ_AR = 'America/Argentina/Buenos_Aires';

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function str(v) {
  if (v == null || v === '') return '';
  return String(v);
}

function safeText(val, maxLen = null) {
  if (val == null || val === '') return '';
  let s = String(val);
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  s = s.replace(/Ð/g, '\n');
  s = s.replace(/\uFFFD/g, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  if (typeof maxLen === 'number' && maxLen > 0 && s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  return s;
}

function formatFechaHoraAR(value) {
  if (value == null || value === '') return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return str(value);
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ_AR,
    }).format(d);
  } catch {
    return str(value);
  }
}

function formatMedFechaHora(m) {
  const fd = str(m.FechaControl);
  const ht = str(m.HoraControl);
  if (!fd && !ht) return '—';
  if (fd.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(fd)) {
    try {
      const t = ht ? `${fd.split('T')[0]}T${String(ht).replace(/:/g, ':').slice(0, 8)}` : fd;
      const d = new Date(t);
      if (!Number.isNaN(d.getTime())) return formatFechaHoraAR(d);
    } catch (_) {
      /* fallthrough */
    }
  }
  return `${fd} ${ht}`.trim() || '—';
}

function ensureSpace(doc, minBottom = 72) {
  const mb = doc.page.margins.bottom;
  const limit = doc.page.height - mb - minBottom;
  if (doc.y > limit) {
    doc.addPage();
  }
}

const SECTION_LABEL_ES = {
  admision: 'Admisión',
  hcIngreso: 'HC ingreso',
  practicas: 'Prácticas',
  indicaciones: 'Indicaciones',
  medicamentos: 'Medicamentos',
  evoluciones: 'Evoluciones',
  estudios: 'Estudios laboratorio',
  protocolos: 'Protocolos',
  adjuntos: 'Adjuntos',
};

const HCI_SECCIONES_CONFIG = {
  PF: 'PIEL Y FANERAS',
  TCS: 'TEJIDO CELULAR SUBCUTÁNEO',
  SL: 'SISTEMA LINFÁTICO',
  SOAM: 'SISTEMA OSTEOARTICULOMUSCULAR',
  C: 'CABEZA',
  CU: 'CUELLO',
  M: 'MAMAS',
  AR: 'APARATO RESPIRATORIO',
  AC: 'APARATO CARDIOVASCULAR',
  ACV: 'APARATO CARDIOVASCULAR',
  A: 'ABDOMEN',
  AUG: 'APARATO UROGENITAL',
  AIG: 'APARATO DIGESTIVO INFERIOR',
  SN: 'SISTEMA NERVIOSO',
  EC: 'ELECTROCARDIOGRAMA',
  RDT: 'RADIOGRAFÍA DE TÓRAX',
  PD: 'PLAN DIAGNÓSTICO',
  PT: 'PLAN TERAPÉUTICO',
  AD: 'ANTECEDENTES',
  EN: 'ENFERMEDAD',
  EG: 'EXAMEN GINECOLÓGICO',
  DIA: 'DIAGNÓSTICO',
  CTRL: 'CONTROL FRECUENTE (ASOCIADO A LA HC)',
};

const SV_VENOSO_HEADS = new Set(['VARICES', 'FLEBITIS', 'TROMBOSIS', 'CIRCULACIONCOLATERAL']);
const EO_OFTALMO_HEADS = new Set([
  'FONDODEOJO',
  'MEDIOSBIREFRINGENTES',
  'CRUCES',
  'RELACION',
  'HEMORRAGIAEXUDADOS',
]);

const HCI_IGNORE_KEYS = new Set([
  'IdHCIngreso',
  'NumeroVisita',
  'IdSector',
  'IdProfecional',
  'Fecha',
  'FechaFormateada',
  'HoraFormateada',
  'ProfesionalNombre',
  'SectorDescripcion',
  'MotivoConsulta',
  'EnfermedadActual',
]);

const HCI_CAMPOS_TEXTO_LIBRE = {
  ModMedica: 'MODIFICACIÓN MÉDICA',
  Semiologia: 'SEMIOLOGÍA',
  IMPRESIONDIAGNOSTICA: 'IMPRESIÓN DIAGNÓSTICA',
  COMENTARIODEINGRESO: 'COMENTARIO DE INGRESO',
  EXAMENCOMPLEMENTARIO: 'EXÁMENES COMPLEMENTARIOS',
};

const HCI_SECTION_ORDER = [
  'SIGNOS VITALES',
  'SISTEMA VENOSO',
  'PIEL Y FANERAS',
  'TEJIDO CELULAR SUBCUTÁNEO',
  'SISTEMA LINFÁTICO',
  'SISTEMA OSTEOARTICULOMUSCULAR',
  'CABEZA',
  'CUELLO',
  'MAMAS',
  'MAMAS — INSPECCIÓN',
  'MAMAS — PALPACIÓN',
  'APARATO RESPIRATORIO',
  'APARATO CARDIOVASCULAR',
  'ABDOMEN',
  'APARATO UROGENITAL',
  'APARATO DIGESTIVO INFERIOR',
  'SISTEMA NERVIOSO',
  'EXAMEN OBSTÉTRICO',
  'EXAMEN OFTALMOLÓGICO',
  'ELECTROCARDIOGRAMA',
  'RADIOGRAFÍA DE TÓRAX',
  'PLAN DIAGNÓSTICO',
  'PLAN TERAPÉUTICO',
  'ANTECEDENTES',
  'ENFERMEDAD',
  'EXAMEN GINECOLÓGICO',
  'DIAGNÓSTICO',
  'CONTROL FRECUENTE (ASOCIADO A LA HC)',
  'OTROS DATOS DE LA HC',
];

function hciHeadAfterPrefix(key, prefixLen) {
  const rest = key.slice(prefixLen + 1);
  return rest.split('_')[0] || rest;
}

function hciTituloSeccion(fieldKey) {
  const key = String(fieldKey || '').toUpperCase();
  if (key.startsWith('CTRL_')) return HCI_SECCIONES_CONFIG.CTRL;
  const match = key.match(/^([A-Z]+)_/);
  if (!match) return null;
  const pref = match[1];
  const head = hciHeadAfterPrefix(key, pref.length);
  if (pref === 'SV') {
    if (SV_VENOSO_HEADS.has(head)) return 'SISTEMA VENOSO';
    return 'SIGNOS VITALES';
  }
  if (pref === 'EO') {
    if (EO_OFTALMO_HEADS.has(head)) return 'EXAMEN OFTALMOLÓGICO';
    return 'EXAMEN OBSTÉTRICO';
  }
  if (pref === 'MI') return 'MAMAS — INSPECCIÓN';
  if (pref === 'MP') return 'MAMAS — PALPACIÓN';
  return HCI_SECCIONES_CONFIG[pref] || null;
}

function hciLabelCampo(key) {
  const norm = String(key || '').toUpperCase();
  const sinPrefijo = norm.replace(/^[A-Z]+_/, '');
  return sinPrefijo
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function buildHcDisplaySections(row) {
  const map = {};
  Object.keys(row || {}).forEach((keyRaw) => {
    const key = String(keyRaw || '').trim();
    const keyUpper = key.toUpperCase();
    const ignore =
      HCI_IGNORE_KEYS.has(key) ||
      HCI_IGNORE_KEYS.has(keyUpper) ||
      Object.prototype.hasOwnProperty.call(HCI_CAMPOS_TEXTO_LIBRE, key) ||
      Object.prototype.hasOwnProperty.call(HCI_CAMPOS_TEXTO_LIBRE, keyUpper);
    if (ignore) return;
    const value = row[key];
    if (value == null || value === '' || typeof value === 'object') return;
    const sec = hciTituloSeccion(keyUpper) || (keyUpper.includes('_') ? 'OTROS DATOS DE LA HC' : null);
    if (!sec) return;
    if (!map[sec]) map[sec] = [];
    map[sec].push({ label: hciLabelCampo(keyUpper), valor: String(value) });
  });
  return Object.keys(map)
    .sort((a, b) => {
      const ia = HCI_SECTION_ORDER.indexOf(a);
      const ib = HCI_SECTION_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'es');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map((titulo) => ({ titulo, campos: map[titulo] }));
}

function humanizarSecciones(list) {
  if (!Array.isArray(list)) return '';
  return list.map((s) => SECTION_LABEL_ES[s] || s).join(' · ');
}

function sectionTitle(doc, title) {
  const left = doc.page.margins.left;
  const w = contentWidth(doc);
  ensureSpace(doc, 30);
  const y = doc.y;
  doc.save();
  doc.roundedRect(left, y, w, 22, 3).fill(SECTION_BG).stroke(SECTION_BORDER);
  doc.fillColor('#0a4a5c').font('Helvetica-Bold').fontSize(10.5).text(title, left + 10, y + 5, { width: w - 20 });
  doc.restore();
  doc.y = y + 28;
  doc.fillColor('#0f172a').font('Helvetica');
}

function drawCoverBlock(doc, payload) {
  const left = doc.page.margins.left;
  const w = contentWidth(doc);
  const c = payload.criterios || {};
  const colW = (w - 14) / 2;
  const y0 = doc.y;

  doc.save();
  doc.roundedRect(left, y0, w, 96, 4).fill('#f0f9fc').stroke('#9dd5e8');
  doc.restore();

  let y = y0 + 10;
  const padL = left + 12;
  const mid = padL + colW + 6;

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0083a9').text('Exportación clínica', padL, y0 + 8, { width: w - 24 });
  y = y0 + 30;

  doc.font('Helvetica').fontSize(8).fillColor('#0f172a').text(`Visita: ${str(payload.numeroVisita)}`, padL, y, {
    width: colW,
  });
  doc.text(`Generado: ${formatFechaHoraAR(payload.generadoEn)}`, mid, y, { width: colW });
  y += 16;

  const crit = c.exportAll ? 'Sin filtro de fechas' : `Desde ${str(c.fechaInicio) || '—'} hasta ${str(c.fechaFin) || '—'}`;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text('Criterios: ', padL, y, { continued: true });
  doc.font('Helvetica').fillColor('#0f172a').text(crit, { width: w - 24 });
  y += 14;

  if (Array.isArray(c.sections) && c.sections.length) {
    doc.font('Helvetica-Bold').fontSize(8).text('Secciones: ', padL, y, { continued: true });
    doc.font('Helvetica').fontSize(7.5).text(humanizarSecciones(c.sections), { width: w - 24 });
    y += 14;
  }

  if (c.evolucionSectorIds && c.evolucionSectorIds.length) {
    doc.font('Helvetica-Bold').fontSize(7.5).text('Evoluciones por servicio (IdSector): ', padL, y, { continued: true });
    doc.font('Helvetica').text(c.evolucionSectorIds.join(', '), { width: w - 24 });
    y += 12;
  }

  doc.y = y0 + 102;
  doc.fillColor('#0f172a').font('Helvetica');
}

function keyValRow2(doc, pairs) {
  const left = doc.page.margins.left;
  const w = contentWidth(doc);
  const colW = (w - 10) / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    ensureSpace(doc, 30);
    const yy = doc.y;
    const [k1, v1] = pairs[i];
    const p2 = pairs[i + 1];
    const t1 = `${k1}: ${safeText(v1)}`;
    doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a').text(t1, left, yy, { width: colW - 4 });
    let rowH = doc.y - yy;
    if (p2) {
      const [k2, v2] = p2;
      const t2 = `${k2}: ${safeText(v2)}`;
      doc.text(t2, left + colW + 6, yy, { width: colW - 4 });
      rowH = Math.max(rowH, doc.y - yy);
    }
    doc.y = yy + rowH + 2;
  }
}

function renderIndicacionesGrid(doc, items) {
  if (!items.length) return;
  sectionTitle(doc, 'Indicaciones');
  const left = doc.page.margins.left;
  const w = contentWidth(doc);
  const cols = 3;
  const gap = 6;
  const cellW = (w - gap * (cols - 1)) / cols;
  const pad = 4;

  for (let rowStart = 0; rowStart < items.length; rowStart += cols) {
    const rowItems = items.slice(rowStart, rowStart + cols);
    const heights = rowItems.map((ind, idx) => {
      const lines = [
        `#${rowStart + idx + 1}  Nº ${str(ind.nroIndicacion)}`,
        `Desc.: ${safeText(ind.descripcion)}`,
        `Med.: ${safeText(ind.medicamento)}`,
        `Freq.: ${safeText(ind.frecuencia)}`,
        `Prof.: ${safeText(ind.fullName)}`,
        `Obs.: ${safeText(ind.observaciones)}`,
      ];
      if (ind.indicacionesHijas && ind.indicacionesHijas.length) {
        const hij = ind.indicacionesHijas
          .map((h) => `#${str(h.nroIndicacion || '')} ${safeText(h.descripcion || h.medicamento)}`)
          .join(' | ');
        lines.push(`Hijas: ${hij}`);
      }
      doc.font('Helvetica').fontSize(6.3);
      const h = doc.heightOfString(lines.join('\n'), { width: cellW - pad * 2 });
      return Math.max(36, h + 12);
    });
    const cellH = Math.max(...heights);
    ensureSpace(doc, cellH + 8);
    const rowTop = doc.y;

    rowItems.forEach((ind, c) => {
      const x = left + c * (cellW + gap);
      doc.save();
      doc.roundedRect(x, rowTop, cellW, cellH, 3).fill('#ffffff').stroke('#cbd5e1');
      doc.restore();

      const lines = [
        `#${rowStart + c + 1}  Nº ${str(ind.nroIndicacion)}`,
        `Desc.: ${safeText(ind.descripcion)}`,
        `Med.: ${safeText(ind.medicamento)}`,
        `Freq.: ${safeText(ind.frecuencia)}`,
        `Prof.: ${safeText(ind.fullName)}`,
        `Obs.: ${safeText(ind.observaciones)}`,
      ];
      if (ind.indicacionesHijas && ind.indicacionesHijas.length) {
        const hij = ind.indicacionesHijas
          .map((h) => `#${str(h.nroIndicacion || '')} ${safeText(h.descripcion || h.medicamento)}`)
          .join(' | ');
        lines.push(`Hijas: ${hij}`);
      }

      doc.font('Helvetica').fontSize(6.3).fillColor('#334155').text(lines.join('\n'), x + pad, rowTop + pad, {
        width: cellW - pad * 2,
      });
    });

    // Reducimos ~50% el espacio vertical entre filas de indicaciones.
    doc.y = rowTop + cellH + 4;
  }
  doc.moveDown(0.2);
}

function renderPracticasPacienteTable(doc, items) {
  if (!items.length) return;
  sectionTitle(doc, 'Prácticas por paciente');
  const left = doc.page.margins.left;
  const w = contentWidth(doc);
  const colW = [w * 0.25, w * 0.2, w * 0.27, w * 0.28];
  const headerH = 16;
  const rowH = 20;

  const drawRow = (y, cells, header) => {
    let x = left;
    doc.fillColor(header ? '#0f172a' : '#334155');
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 7.2);
    for (let i = 0; i < colW.length; i += 1) {
      doc.text(safeText(cells[i]), x + 3, y + 3, {
        width: colW[i] - 6,
        height: (header ? headerH : rowH) - 6,
        ellipsis: true,
      });
      x += colW[i];
    }
  };

  ensureSpace(doc, headerH + 6);
  let y = doc.y;
  doc.save();
  doc.rect(left, y, w, headerH).fill('#e0f2fe').stroke('#93c5fd');
  doc.restore();
  drawRow(y, ['Práctica', 'Cantidad', 'Fecha', 'Hora inicio'], true);
  doc.y = y + headerH + 2;

  items.forEach((p, i) => {
    ensureSpace(doc, rowH + 4);
    y = doc.y;
    doc.save();
    doc.rect(left, y, w, rowH).fill(i % 2 === 0 ? '#fafafa' : '#ffffff').stroke('#e5e7eb');
    doc.restore();
    drawRow(
      y,
      [str(p.PracticaDescripcion || p.Practica), str(p.CantidadPractica), str(p.FechaPractica), str(p.HoraPracticaInicio)],
      false
    );
    doc.y = y + rowH + 2;
  });
  doc.moveDown(0.25);
}

function renderMedicamentosTable(doc, items) {
  if (!items.length) return;
  sectionTitle(doc, 'Medicamentos suministrados');
  const left = doc.page.margins.left;
  const w = contentWidth(doc);
  const cw = [w * 0.34, w * 0.2, w * 0.14, w * 0.32];
  const headerH = 16;
  const bodyRowH = 26;

  function rowCellsAt(y, cells, header) {
    let x = left;
    doc.fillColor(header ? '#0f172a' : '#334155');
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 7);
    for (let i = 0; i < 4; i += 1) {
      doc.text(safeText(cells[i], 800), x + 3, y + 3, {
        width: cw[i] - 6,
        height: header ? headerH - 6 : bodyRowH - 6,
        ellipsis: !header,
      });
      x += cw[i];
    }
  }

  ensureSpace(doc, headerH + 8);
  let y = doc.y;
  doc.save();
  doc.rect(left, y, w, headerH).fill('#e0f2fe').stroke('#93c5fd');
  doc.restore();
  rowCellsAt(y, ['Medicamento', 'Fecha / hora', 'Cantidad', 'Observaciones'], true);
  doc.y = y + headerH + 2;

  items.forEach((m, i) => {
    ensureSpace(doc, bodyRowH + 4);
    y = doc.y;
    doc.save();
    doc.rect(left, y, w, bodyRowH).fill(i % 2 === 0 ? '#fafafa' : '#ffffff').stroke('#e5e7eb');
    doc.restore();
    const med = str(m.NombreMedicamento || m.AliasMedicamento || m.DescripcionMedicamento || '—');
    const cant = `${str(m.Cantidad)} ${str(m.TipoUnidad)}`.trim();
    rowCellsAt(y, [med, formatMedFechaHora(m), cant || '—', str(m.Observaciones)], false);
    doc.y = y + bodyRowH + 2;
  });
  doc.moveDown(0.3);
}

async function prepareAdjuntosResueltos(adjuntosMeta) {
  const list = Array.isArray(adjuntosMeta) ? adjuntosMeta : [];
  const out = await Promise.all(
    list.map(async (a) => {
      const id = a.IdAdjunto;
      const fetched = await adjuntosService.fetchAdjuntoFileBuffer(id);
      const nombre = fetched.nombreArchivo || a.NombreArchivo || 'archivo';
      const ext = path.extname(nombre).toLowerCase();
      let kind = 'none';
      let buffer = fetched.buffer;
      let prepared = null;

      if (buffer && buffer.length > 0) {
        if (['.jpg', '.jpeg', '.png'].includes(ext)) {
          kind = 'image';
          prepared = buffer;
        } else if (['.gif', '.webp', '.tif', '.tiff'].includes(ext)) {
          try {
            prepared = await sharp(buffer).png().toBuffer();
            kind = 'image';
          } catch (e) {
            kind = 'error';
            fetched.error = e.message;
          }
        } else if (ext === '.pdf') {
          kind = 'pdf';
          prepared = buffer;
        } else {
          kind = 'unsupported';
        }
      } else {
        kind = 'error';
      }

      return {
        meta: a,
        nombreArchivo: nombre,
        ext,
        kind,
        buffer: prepared || buffer,
        error: fetched.error,
      };
    })
  );
  return out;
}

function bodyParagraph(doc, text) {
  const w = contentWidth(doc);
  const t = safeText(text);
  if (!t) return;
  ensureSpace(doc, 36);
  doc.fontSize(8).font('Helvetica').fillColor('#1e293b').text(t, { width: w, lineGap: 1 });
  doc.moveDown(0.25);
}

/**
 * @param {object} payload - resultado de exportarAdmisionSelectivo
 * @returns {Promise<Buffer>}
 */
async function buildSelectiveExportPdf(payload) {
  const adjuntosResueltos =
    payload.adjuntos && payload.adjuntos.length ? await prepareAdjuntosResueltos(payload.adjuntos) : [];

  const pdfAnnexBuffers = [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: MARGIN,
      size: 'A4',
      info: {
        Title: `Exportación visita ${payload.numeroVisita || ''}`,
        Author: 'iMedicWS',
      },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', async () => {
      try {
        let buf = Buffer.concat(chunks);
        if (pdfAnnexBuffers.length > 0) {
          const mainDoc = await PDFLibDocument.load(buf);
          for (const annexBuf of pdfAnnexBuffers) {
            try {
              const annex = await PDFLibDocument.load(annexBuf);
              const copied = await mainDoc.copyPages(annex, annex.getPageIndices());
              copied.forEach((p) => mainDoc.addPage(p));
            } catch (err) {
              console.warn('[PDF export] Anexo PDF omitido:', err.message);
            }
          }
          buf = Buffer.from(await mainDoc.save());
        }
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });

    drawCoverBlock(doc, payload);

    if (payload.admision) {
      sectionTitle(doc, 'Datos de admisión');
      const a = payload.admision;
      keyValRow2(doc, [
        ['Paciente', str(a.ApellidoYNombre)],
        ['DNI', str(a.NumeroDocumento)],
        ['HC', str(a.NumeroHC)],
        ['Fecha admisión', str(a.FechaAdmision)],
        ['Hora', str(a.HoraAdmision)],
        ['Id paciente', str(a.IdPaciente)],
      ]);
      doc.moveDown(0.3);
    }

    if (payload.historialClinico && payload.historialClinico.length) {
      sectionTitle(doc, 'HC de ingreso');
      payload.historialClinico.forEach((row, idx) => {
        ensureSpace(doc, 72);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`Registro ${idx + 1} — ID ${str(row.IdHCIngreso)}`, {
          width: contentWidth(doc),
        });
        doc.font('Helvetica');
        keyValRow2(doc, [
          ['Profesional', str(row.ProfesionalNombre)],
          ['Sector', str(row.SectorDescripcion)],
          ['Fecha', str(row.FechaFormateada || row.Fecha)],
        ]);
        if (safeText(row.MotivoConsulta)) {
          ensureSpace(doc, 30);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text('Motivo de consulta:', {
            width: contentWidth(doc),
          });
          doc.font('Helvetica').fontSize(8).fillColor('#0f172a').text(safeText(row.MotivoConsulta), {
            width: contentWidth(doc),
          });
          doc.moveDown(0.2);
        }
        // Enfermedad actual: fila completa (sin columnas) como solicitó usuario.
        if (safeText(row.EnfermedadActual)) {
          ensureSpace(doc, 32);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text('Enfermedad actual:', {
            width: contentWidth(doc),
          });
          doc.font('Helvetica').fontSize(8).fillColor('#0f172a').text(safeText(row.EnfermedadActual), {
            width: contentWidth(doc),
          });
          doc.moveDown(0.2);
        }

        Object.entries(HCI_CAMPOS_TEXTO_LIBRE).forEach(([field, label]) => {
          const text = safeText(row[field]);
          if (!text) return;
          ensureSpace(doc, 30);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text(`${label}:`, {
            width: contentWidth(doc),
          });
          doc.font('Helvetica').fontSize(8).fillColor('#0f172a').text(text, {
            width: contentWidth(doc),
          });
          doc.moveDown(0.2);
        });

        const secciones = buildHcDisplaySections(row);
        secciones.forEach((sec) => {
          ensureSpace(doc, 26);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#0369a1').text(sec.titulo, {
            width: contentWidth(doc),
          });
          keyValRow2(
            doc,
            sec.campos.map((c) => [c.label, safeText(c.valor)])
          );
          doc.moveDown(0.15);
        });
        doc.moveDown(0.35);
      });
    }

    if (payload.indicaciones && payload.indicaciones.length) {
      renderIndicacionesGrid(doc, payload.indicaciones);
    }

    if (payload.practicasPaciente && payload.practicasPaciente.length) {
      renderPracticasPacienteTable(doc, payload.practicasPaciente);
    }

    if (payload.medicamentos && payload.medicamentos.length) {
      renderMedicamentosTable(doc, payload.medicamentos);
    }

    if (payload.evolucionesMedicas && payload.evolucionesMedicas.length) {
      sectionTitle(doc, 'Evoluciones médicas');
      payload.evolucionesMedicas.forEach((e, ei) => {
        ensureSpace(doc, 34);
        const head = `#${ei + 1} · ${str(e.FechaEv)} ${str(e.HoraEv)} · ${str(e.ProfesionalNombreCompleto)}`;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(head, { width: contentWidth(doc) });
        bodyParagraph(doc, safeText(e.Evolucion));
        doc.moveDown(0.1);
      });
    }

    if (payload.practicas && payload.practicas.laboratorios && payload.practicas.laboratorios.length) {
      sectionTitle(doc, 'Estudios solicitados (laboratorio)');
      payload.practicas.laboratorios.forEach((ex) => {
        ensureSpace(doc, 48);
        doc.font('Helvetica-Bold').fontSize(9).text(`${str(ex.TipoEstudio)} — ${str(ex.FechaExamen)} ${str(ex.HoraExamen)}`, {
          width: contentWidth(doc),
        });
        doc.font('Helvetica').fontSize(8);
        if (ex.Protocolo) doc.fillColor('#475569').text(`Protocolo: ${str(ex.Protocolo)}`, { width: contentWidth(doc) });
        doc.fillColor('#1e293b');
        if (ex.detalles && ex.detalles.length) {
          const leftL = doc.page.margins.left;
          const wL = contentWidth(doc);
          const c2 = (wL - 8) / 2;
          const det = ex.detalles.slice(0, 80);
          for (let di = 0; di < det.length; di += 2) {
            ensureSpace(doc, 14);
            const rowY = doc.y;
            const d0 = det[di];
            const d1 = det[di + 1];
            const line0 = `• ${str(d0.NombreParametro)}: ${str(d0.Resultado)} (ref. ${str(d0.ValorReferencia)})`;
            doc.fontSize(6.8).fillColor('#1e293b').text(safeText(line0, 280), leftL, rowY, {
              width: c2 - 4,
              height: 12,
              ellipsis: true,
            });
            if (d1) {
              const line1 = `• ${str(d1.NombreParametro)}: ${str(d1.Resultado)} (ref. ${str(d1.ValorReferencia)})`;
              doc.text(safeText(line1, 280), leftL + c2 + 6, rowY, { width: c2 - 4, height: 12, ellipsis: true });
            }
            doc.y = rowY + 13;
          }
          if (ex.detalles.length > 80) {
            doc.fontSize(7.5).fillColor('#64748b').text(`… y ${ex.detalles.length - 80} parámetros más`, {
              width: contentWidth(doc),
            });
          }
        }
        doc.moveDown(0.25);
      });
    }

    if (payload.protocolos && payload.protocolos.length) {
      sectionTitle(doc, 'Protocolos');
      const left = doc.page.margins.left;
      const w = contentWidth(doc);
      const c3 = (w - 12) / 3;
      let rowTop = doc.y;
      payload.protocolos.forEach((p, n) => {
        const col = n % 3;
        if (col === 0) {
          ensureSpace(doc, 34);
          rowTop = doc.y;
        }
        const x = left + col * (c3 + 4);
        const line = `Prot. ${str(p.Protocolo)} · ${str(p.TipoEstudio)}\n${str(p.FechaExamen)} · ${str(p.Laboratorio)}`;
        doc.fontSize(7).fillColor('#1e293b').text(safeText(line, 400), x, rowTop, { width: c3 - 4, height: 28, ellipsis: true });
        if (col === 2) {
          doc.y = rowTop + 30;
        }
      });
      if (payload.protocolos.length % 3 !== 0) {
        doc.y = rowTop + 30;
      }
      doc.moveDown(0.2);
    }

    if (adjuntosResueltos.length) {
      adjuntosResueltos.forEach((adj) => {
        // PDFs: se anexan directo, sin página intermedia.
        if (adj.kind === 'pdf' && adj.buffer) {
          pdfAnnexBuffers.push(adj.buffer);
          return;
        }

        // Para el resto, cada adjunto mantiene su hoja dedicada.
        doc.addPage();

        const titulo = str(adj.nombreArchivo || 'Adjunto');
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(titulo, {
          width: contentWidth(doc),
        });
        doc.moveDown(0.2);

        if (adj.kind === 'image' && adj.buffer) {
          try {
            const left = doc.page.margins.left;
            const top = doc.y;
            const fw = contentWidth(doc);
            const fh = Math.max(80, doc.page.height - doc.page.margins.bottom - top);
            doc.image(adj.buffer, left, top, {
              fit: [fw, fh],
              align: 'center',
              valign: 'center',
            });
          } catch (e) {
            doc.font('Helvetica').fontSize(8).fillColor('#b91c1c').text(`No se pudo incrustar la imagen: ${e.message}`, {
              width: contentWidth(doc),
            });
          }
        } else if (adj.kind === 'unsupported') {
          doc.font('Helvetica').fontSize(8).fillColor('#92400e').text(
            'Formato no incrustable en PDF; descargá el archivo desde el sistema con el IdAdjunto indicado.',
            { width: contentWidth(doc) }
          );
        } else {
          doc.font('Helvetica').fontSize(8).fillColor('#b91c1c').text(
            `No se pudo obtener el archivo${adj.error ? `: ${adj.error}` : '.'}`,
            { width: contentWidth(doc) }
          );
        }
      });
    }

    doc.end();
  });
}

module.exports = {
  buildSelectiveExportPdf,
};
