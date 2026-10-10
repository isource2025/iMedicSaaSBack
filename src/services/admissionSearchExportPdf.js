const PDFDocument = require('pdfkit');
const path = require('path');
const { PDFDocument: PDFLibDocument } = require('pdf-lib');
const sharp = require('sharp');
const adjuntosService = require('./adjuntos.service');
const { resolverFirmas, claveFirmante } = require('./firmasPdf.service');

const TZ_AR = 'America/Argentina/Buenos_Aires';

const MARGINS = { top: 58, bottom: 46, left: 40, right: 40 };

const C = {
  brand: '#0083a9',
  brandDark: '#0a4a5c',
  brandSoft: '#e6f6fb',
  brandLine: '#9dd5e8',
  text: '#0f172a',
  body: '#1e293b',
  muted: '#64748b',
  border: '#cbd5e1',
  zebra: '#f8fafc',
  danger: '#b91c1c',
  warn: '#92400e',
};

function str(v) {
  if (v == null || v === '') return '';
  return String(v);
}

function safeText(val, maxLen = null) {
  if (val == null || val === '') return '';
  let s = String(val);
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // Clarion / encoding: Ð y similares se usan como saltos de línea basura
  s = s.replace(/[\u00D0ÐÞþ]/g, '\n');
  s = s.replace(/\uFFFD/g, '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.trim();
  if (typeof maxLen === 'number' && maxLen > 0 && s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  return s;
}

/** Texto clínico: algunos campos legacy vienen en RTF. */
function plain(val) {
  const s = str(val);
  if (!s.trim().startsWith('{\\rtf')) return safeText(s);
  try {
    return safeText(require('./estudios.service').rtfToPlain(s));
  } catch {
    return safeText(s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, ''));
  }
}

function fmtFecha(v) {
  const s = str(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function fmtHora(v) {
  const s = str(v).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** "2026-10-08 10:30:00" | "2026-10-08T10:30" | (fecha, hora) → "08/10/2026 10:30" */
function fmtFechaHora(fecha, hora) {
  const f = str(fecha).trim();
  if (!f) return fmtHora(hora);
  const h = fmtHora(hora) || (/[T ]\d{1,2}:\d{2}/.test(f) ? fmtHora(f.slice(10)) : '');
  return [fmtFecha(f), h].filter(Boolean).join(' ');
}

function formatAhoraAR(value) {
  try {
    const d = value ? new Date(value) : new Date();
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ_AR,
    }).format(d);
  } catch {
    return '';
  }
}

function joinNombre(...parts) {
  return parts.map((p) => str(p).trim()).filter(Boolean).join(' ');
}

function matriculaTxt(m) {
  const n = Number(m);
  return Number.isFinite(n) && n > 0 && n !== 999999 ? `Mat. ${n}` : '';
}

/** "APELLIDO NOMBRE · Mat. 1234" para columnas de tabla. */
function profesionalCelda(signer) {
  if (!signer) return '';
  return [str(signer.nombre).trim(), matriculaTxt(signer.matricula)].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Firmantes por bloque. La misma función alimenta la resolución de firmas y el dibujo.
// `valor` solo se usa cuando el origen garantiza que es imPersonal.Valor.
// ---------------------------------------------------------------------------

const firmante = {
  hci: (r) => ({ nombre: str(r.ProfesionalNombre), matricula: r.Matricula, valor: r.IdPersonal }),
  indicacion: (r) => ({ nombre: str(r.fullName), matricula: r.matricula }),
  evolucion: (r) => ({ nombre: str(r.ProfesionalNombreCompleto), matricula: r.Matricula, valor: r.IdPersonal }),
  epicrisis: (r) => ({
    nombre: str(r.ProfesionalNombreCompleto || r.profesionalNombreCompleto),
    matricula: r.Profecional,
  }),
  estudioRealizador: (r) =>
    str(r.RealizadorNombre || r.realizadorNombre).trim()
      ? { nombre: str(r.RealizadorNombre || r.realizadorNombre), matricula: r.MatriculaRealizador ?? r.matriculaRealizador }
      : null,
  estudioSolicitante: (r) =>
    str(r.MedicoSolicitanteNombre || r.medicoSolicitanteNombre).trim()
      ? {
          nombre: str(r.MedicoSolicitanteNombre || r.medicoSolicitanteNombre),
          matricula: r.MatriculaSolicitante ?? r.matriculaSolicitante,
        }
      : null,
  interSolicitante: (r) =>
    str(r.MedicoSolicitanteNombre).trim() ? { nombre: str(r.MedicoSolicitanteNombre), matricula: r.MedicoSolicitante } : null,
  interRespuesta: (r) =>
    str(r.Respuesta).trim() && str(r.RealizadorNombre).trim()
      ? { nombre: str(r.RealizadorNombre), matricula: r.MatriculaRealizador }
      : null,
  protocolo: (r) => (str(r.operadorNombre).trim() ? { nombre: str(r.operadorNombre), matricula: r.operadorMatricula } : null),
  control: (r) => ({ nombre: joinNombre(r.ProfesionalApellido, r.ProfesionalNombres), matricula: r.Matricula }),
  medicacion: (r) => ({
    nombre: str(r.ProfesionalFullName) || joinNombre(r.ProfesionalApellido, r.ProfesionalNombres),
    matricula: r.Matricula,
  }),
  dieta: (r) => ({ nombre: str(r.ProfesionalFullName || r.OperadorFullName), matricula: r.Matricula }),
  balance: (r) => ({ nombre: joinNombre(r.ProfesionalApellido, r.ProfesionalNombres), matricula: r.Matricula }),
  evolucionEnf: (r) => ({ nombre: joinNombre(r.ProfesionalApellido, r.ProfesionalNombres), matricula: r.Matricula }),
  // Insumos solo traen el operador de carga (CodOperador): se muestra el nombre, sin buscar firma.
  insumo: (r) => ({ nombre: str(r.fullName) }),
};

function todosLosFirmantes(p) {
  const out = [];
  const add = (rows, fn) => {
    for (const r of rows || []) {
      const s = fn(r);
      if (s) out.push(s);
    }
  };
  add(p.historialClinico, firmante.hci);
  add(p.indicaciones, firmante.indicacion);
  add(p.evolucionesMedicas, firmante.evolucion);
  add(p.epicrisis, firmante.epicrisis);
  add(p.estudios, firmante.estudioRealizador);
  add(p.estudios, firmante.estudioSolicitante);
  add(p.interconsultas, firmante.interSolicitante);
  add(p.interconsultas, firmante.interRespuesta);
  add(p.protocolos, firmante.protocolo);
  add(p.controles, firmante.control);
  add(p.medicamentos, firmante.medicacion);
  add(p.dietas, firmante.dieta);
  add(p.balanceHidrico, firmante.balance);
  add(p.evolucionesEnfermeria, firmante.evolucionEnf);
  return out;
}

// ---------------------------------------------------------------------------
// Primitivas de layout
// ---------------------------------------------------------------------------

function cw(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function left(doc) {
  return doc.page.margins.left;
}

function bottomLimit(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > bottomLimit(doc)) doc.addPage();
}

function groupTitle(doc, title) {
  ensureSpace(doc, 90);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.brand).text(title.toUpperCase(), left(doc), y, {
    width: cw(doc),
    characterSpacing: 1.2,
  });
  const ly = doc.y + 2;
  doc.save().moveTo(left(doc), ly).lineTo(left(doc) + cw(doc), ly).lineWidth(1).strokeColor(C.brand).stroke().restore();
  doc.y = ly + 8;
}

function sectionTitle(doc, title, count) {
  ensureSpace(doc, 70);
  const y = doc.y;
  const w = cw(doc);
  doc.save().roundedRect(left(doc), y, w, 20, 3).fill(C.brandSoft).restore();
  doc.save().rect(left(doc), y, 3, 20).fill(C.brand).restore();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.brandDark).text(title, left(doc) + 10, y + 5.5, {
    width: w - 80,
    lineBreak: false,
  });
  if (count != null) {
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(
      `${count} registro${count === 1 ? '' : 's'}`,
      left(doc) + w - 120,
      y + 6.5,
      { width: 110, align: 'right', lineBreak: false },
    );
  }
  doc.y = y + 28;
  doc.fillColor(C.text);
}

/** Encabezado de un registro: título a la izquierda, metadatos a la derecha. */
function recordHeader(doc, title, meta) {
  ensureSpace(doc, 64);
  const y = doc.y;
  const w = cw(doc);
  const metaTxt = safeText(meta);
  doc.font('Helvetica').fontSize(7.5);
  const metaW = metaTxt ? Math.min(w * 0.55, doc.widthOfString(metaTxt) + 4) : 0;
  doc.font('Helvetica-Bold').fontSize(9);
  const titleW = w - metaW - 12;
  const titleH = doc.heightOfString(safeText(title) || '—', { width: titleW });
  const h = Math.max(16, titleH + 6);
  doc.save().rect(left(doc), y, w, h).fill(C.zebra).restore();
  doc.save().moveTo(left(doc), y + h).lineTo(left(doc) + w, y + h).lineWidth(0.5).strokeColor(C.border).stroke().restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text).text(safeText(title) || '—', left(doc) + 6, y + 4, { width: titleW });
  if (metaTxt) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(metaTxt, left(doc) + w - metaW - 6, y + 4.5, {
      width: metaW,
      align: 'right',
    });
  }
  doc.y = y + h + 5;
  doc.fillColor(C.text);
}

/** Pares etiqueta: valor en N columnas (omite vacíos). */
function fieldGrid(doc, pairs, cols = 2) {
  const items = pairs.filter(([, v]) => safeText(v));
  if (!items.length) return;
  const gap = 12;
  const colW = (cw(doc) - gap * (cols - 1)) / cols;
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols);
    doc.fontSize(8);
    const heights = row.map(([k, v]) => {
      doc.font('Helvetica-Bold');
      return doc.heightOfString(`${k}: ${safeText(v)}`, { width: colW });
    });
    const rowH = Math.max(...heights);
    ensureSpace(doc, rowH + 4);
    const y = doc.y;
    row.forEach(([k, v], ci) => {
      const x = left(doc) + ci * (colW + gap);
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(C.muted)
        .text(`${k}: `, x, y, { width: colW, continued: true })
        .font('Helvetica')
        .fillColor(C.text)
        .text(safeText(v));
    });
    doc.y = y + rowH + 3;
  }
}

function textBlock(doc, label, text) {
  const t = plain(text);
  if (!t) return;
  ensureSpace(doc, 34);
  doc.moveDown(0.15);
  if (label) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.brand).text(label.toUpperCase(), left(doc), doc.y, {
      width: cw(doc),
      characterSpacing: 0.4,
    });
    doc.moveDown(0.1);
  }
  doc.font('Helvetica').fontSize(8.5).fillColor(C.body).text(t, left(doc), doc.y, { width: cw(doc), lineGap: 1.5 });
  doc.moveDown(0.3);
}

function mutedLine(doc, text, color = C.muted) {
  ensureSpace(doc, 14);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(color).text(text, left(doc), doc.y, { width: cw(doc) });
  doc.moveDown(0.25);
  doc.fillColor(C.text);
}

function recordEnd(doc) {
  doc.moveDown(0.5);
  ensureSpace(doc, 10);
  const y = doc.y;
  doc
    .save()
    .moveTo(left(doc), y)
    .lineTo(left(doc) + cw(doc), y)
    .lineWidth(0.4)
    .dash(2, { space: 2 })
    .strokeColor(C.border)
    .stroke()
    .undash()
    .restore();
  doc.y = y + 10;
}

const SIG_W = 160;
const SIG_IMG_H = 34;
const SIG_H = SIG_IMG_H + 36;

function dedupeFirmantes(signers) {
  const seen = new Set();
  const out = [];
  for (const s of signers) {
    if (!s || !str(s.nombre).trim()) continue;
    const k = claveFirmante(s) || `n:${str(s.nombre).trim().toUpperCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/**
 * Bloques de firma (imagen + línea + aclaración + matrícula).
 * Uno solo va a la derecha; varios se reparten en filas de 3.
 */
function drawSignatures(doc, signers, firmas, { caption } = {}) {
  const list = dedupeFirmantes(signers);
  if (!list.length) return;
  const w = cw(doc);
  const perRow = 3;
  const gap = (w - SIG_W * perRow) / (perRow - 1);
  for (let i = 0; i < list.length; i += perRow) {
    const row = list.slice(i, i + perRow);
    ensureSpace(doc, SIG_H + 6);
    const y = doc.y + 4;
    row.forEach((s, ci) => {
      const x =
        list.length === 1 ? left(doc) + w - SIG_W : left(doc) + ci * (SIG_W + gap);
      const img = firmas.get(claveFirmante(s));
      if (img) {
        try {
          doc.image(img, x + 10, y, { fit: [SIG_W - 20, SIG_IMG_H], align: 'center', valign: 'bottom' });
        } catch {
          /* imagen corrupta: queda la aclaración */
        }
      }
      const ly = y + SIG_IMG_H + 2;
      doc.save().moveTo(x, ly).lineTo(x + SIG_W, ly).lineWidth(0.6).strokeColor('#334155').stroke().restore();
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(C.text)
        .text(str(s.nombre).trim().toUpperCase(), x, ly + 3, { width: SIG_W, align: 'center', lineBreak: false, ellipsis: true });
      const sub = [matriculaTxt(s.matricula), s.rol].filter(Boolean).join(' · ');
      if (sub) {
        doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(sub, x, ly + 13, {
          width: SIG_W,
          align: 'center',
          lineBreak: false,
        });
      }
    });
    doc.y = y + SIG_H;
  }
  if (caption) mutedLine(doc, caption);
  doc.fillColor(C.text);
}

/**
 * Tabla con alto de fila según contenido (sin truncar texto clínico) y encabezado
 * repetido en cada página.
 * @param {{ label: string, width: number, value: (row: object) => string, align?: string }[]} columns
 */
function table(doc, columns, rows, { footer } = {}) {
  if (!rows.length) return;
  const x0 = left(doc);
  const w = cw(doc);
  const widths = columns.map((c) => c.width * w);
  const pad = 3;
  const fs = 7.2;
  // Las columnas numéricas (a la derecha) dejan aire antes de la siguiente columna de texto.
  const innerW = (i) => widths[i] - pad * 2 - (columns[i].align === 'right' ? 6 : 0);

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(7.2);
    const hh = Math.max(
      15,
      ...columns.map((c, i) => doc.heightOfString(c.label, { width: innerW(i) }) + pad * 2),
    );
    const y = doc.y;
    doc.save().rect(x0, y, w, hh).fill(C.brand).restore();
    let x = x0;
    columns.forEach((c, i) => {
      doc.fillColor('#ffffff').text(c.label, x + pad, y + pad, { width: innerW(i), align: c.align || 'left' });
      x += widths[i];
    });
    doc.y = y + hh;
  };

  const drawRow = (cells, ri, bold = false) => {
    const rowFont = () => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
    rowFont();
    const maxH = bottomLimit(doc) - doc.page.margins.top - 30;
    const rowH = Math.min(
      maxH,
      Math.max(14, ...cells.map((t, i) => doc.heightOfString(t || ' ', { width: innerW(i) }) + pad * 2)),
    );
    if (doc.y + rowH > bottomLimit(doc)) {
      doc.addPage();
      drawHeader();
      rowFont();
    }
    const y = doc.y;
    if (ri % 2 === 1 || bold) doc.save().rect(x0, y, w, rowH).fill(bold ? C.brandSoft : C.zebra).restore();
    doc.save().moveTo(x0, y + rowH).lineTo(x0 + w, y + rowH).lineWidth(0.3).strokeColor(C.border).stroke().restore();
    let x = x0;
    doc.fillColor(C.body);
    cells.forEach((t, i) => {
      doc.text(t, x + pad, y + pad, {
        width: innerW(i),
        height: rowH - pad,
        ellipsis: true,
        align: columns[i].align || 'left',
      });
      x += widths[i];
    });
    doc.y = y + rowH;
  };

  ensureSpace(doc, 40);
  drawHeader();
  rows.forEach((row, ri) => drawRow(columns.map((c) => safeText(c.value(row))), ri));
  if (footer) drawRow(footer.map((t) => safeText(t)), 0, true);
  doc.moveDown(0.6);
  doc.fillColor(C.text);
}

// ---------------------------------------------------------------------------
// Encabezados de documento
// ---------------------------------------------------------------------------

function drawInstitucion(doc, empresa, numeroVisita) {
  const x0 = left(doc);
  const w = cw(doc);
  const y0 = 30;
  const nombre = str(empresa?.razonSocial || empresa?.descripcion) || 'Institución';
  const direccion = [
    joinNombre(empresa?.calle, empresa?.calle_nro),
    empresa?.piso ? `Piso ${empresa.piso}` : '',
    empresa?.Depto ? `Dto. ${empresa.Depto}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const lugar = [empresa?.localidad, empresa?.provincia].map(str).filter(Boolean).join(', ');
  const contacto = [
    empresa?.cuit ? `CUIT ${empresa.cuit}` : '',
    empresa?.telefono ? `Tel. ${empresa.telefono}` : '',
    str(empresa?.email),
  ]
    .filter(Boolean)
    .join(' · ');

  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.text).text(nombre, x0, y0, { width: w * 0.6 });
  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
  [direccion, lugar, contacto].filter(Boolean).forEach((l) => doc.text(l, x0, doc.y, { width: w * 0.6 }));
  const yLeft = doc.y;

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(C.brand)
    .text('HISTORIA CLÍNICA', x0 + w * 0.6, y0 + 1, { width: w * 0.4, align: 'right', characterSpacing: 1 });
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(C.text)
    .text(`Visita #${str(numeroVisita)}`, x0 + w * 0.6, doc.y + 1, { width: w * 0.4, align: 'right' });

  const y = Math.max(yLeft, doc.y) + 6;
  doc.save().moveTo(x0, y).lineTo(x0 + w, y).lineWidth(1.2).strokeColor(C.brand).stroke().restore();
  doc.y = y + 8;
}

function drawPacienteCard(doc, a, criterios) {
  if (!a) return;
  const x0 = left(doc);
  const w = cw(doc);
  const y0 = doc.y;
  const pad = 10;

  const egreso = a.FechaEgreso
    ? fmtFechaHora(a.FechaEgreso, a.HoraEgreso)
    : 'Internado / sin egreso';
  const ubicacion = [str(a.SectorDescripcion || a.ServicioEgresoDescripcion), a.Habitacion ? `Hab. ${a.Habitacion}` : '']
    .filter(Boolean)
    .join(' · ');
  const dx = [str(a.Diagnostico), str(a.DiagnosticoDescripcion)].filter(Boolean).join(' — ');
  const cobertura = [str(a.CoberturaOS), str(a.ContratoDescripcion)].filter(Boolean).join(' · ');
  const medico = str(a.DoctorAsistiendoNombre || a.DoctorCabeceraNombre || a.DoctorAdmisorNombre);

  // Alto estimado antes de dibujar el fondo.
  doc.font('Helvetica-Bold').fontSize(12);
  const nameH = doc.heightOfString(str(a.ApellidoYNombre) || '—', { width: w - pad * 2 });
  const lines = 4 + (dx ? 1 : 0);
  const h = pad + nameH + 4 + lines * 12 + pad;

  ensureSpace(doc, h + 10);
  doc.save().roundedRect(x0, y0, w, h, 4).fill('#f0f9fc').restore();
  doc.save().roundedRect(x0, y0, w, h, 4).lineWidth(0.6).strokeColor(C.brandLine).stroke().restore();

  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.text).text(str(a.ApellidoYNombre) || '—', x0 + pad, y0 + pad, {
    width: w - pad * 2,
  });
  doc.y += 3;
  const colW = (w - pad * 2 - 12) / 2;
  const row = (l1, v1, l2, v2) => {
    const y = doc.y;
    const put = (lab, val, x, width) => {
      if (!safeText(val)) return;
      const label = `${lab}: `;
      doc.font('Helvetica-Bold').fontSize(7.8).fillColor(C.muted);
      const lw = doc.widthOfString(label);
      doc.text(label, x, y, { lineBreak: false });
      doc
        .font('Helvetica')
        .fillColor(C.text)
        .text(safeText(val).replace(/\s+/g, ' '), x + lw, y, { width: width - lw, height: 11, ellipsis: true });
    };
    put(l1, v1, x0 + pad, l2 ? colW : w - pad * 2);
    if (l2) put(l2, v2, x0 + pad + colW + 12, colW);
    doc.y = y + 12;
  };
  row('DNI', a.NumeroDocumento || '—', 'HC', a.NumeroHC || '—');
  row('Cobertura', cobertura || '—', 'Nº afiliado', a.NumeroSSN || '—');
  row('Ingreso', fmtFechaHora(a.FechaAdmision, a.HoraAdmision), 'Egreso', egreso);
  row('Ubicación', ubicacion || '—', 'Médico', medico || '—');
  if (dx) row('Diagnóstico', dx);

  doc.y = y0 + h + 6;
  if (criterios) {
    const crit = criterios.exportAll
      ? 'Período: toda la visita'
      : `Período: ${fmtFecha(criterios.fechaInicio) || 'inicio'} al ${fmtFecha(criterios.fechaFin) || 'hoy'}`;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(crit, x0, doc.y, { width: w });
  }
  doc.moveDown(0.6);
  doc.fillColor(C.text);
}

/** Encabezado corrido + pie paginado en todas las páginas generadas por pdfkit. */
function drawRunningChrome(doc, payload, empresa) {
  const a = payload.paciente || payload.admision || {};
  const range = doc.bufferedPageRange();
  const total = range.count;
  const generado = formatAhoraAR(payload.generadoEn);
  const inst = str(empresa?.razonSocial || empresa?.descripcion);
  for (let i = range.start; i < range.start + total; i += 1) {
    doc.switchToPage(i);
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const x0 = doc.page.margins.left;
    const w = doc.page.width - x0 - doc.page.margins.right;
    if (i > range.start) {
      const head = [
        str(a.ApellidoYNombre),
        a.NumeroDocumento ? `DNI ${a.NumeroDocumento}` : '',
        a.NumeroHC ? `HC ${a.NumeroHC}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.text).text(head, x0, 26, {
        width: w * 0.7,
        lineBreak: false,
        ellipsis: true,
      });
      doc.font('Helvetica').fontSize(7.5).fillColor(C.brand).text(`Visita #${str(payload.numeroVisita)}`, x0 + w * 0.7, 26, {
        width: w * 0.3,
        align: 'right',
        lineBreak: false,
      });
      doc.save().moveTo(x0, 39).lineTo(x0 + w, 39).lineWidth(0.5).strokeColor(C.brandLine).stroke().restore();
    }
    const fy = doc.page.height - 30;
    doc.save().moveTo(x0, fy - 6).lineTo(x0 + w, fy - 6).lineWidth(0.4).strokeColor(C.border).stroke().restore();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.muted)
      .text([inst, `Generado ${generado}`].filter(Boolean).join(' · '), x0, fy, { width: w * 0.75, lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${total}`, x0 + w * 0.75, fy, { width: w * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = prevBottom;
  }
}

// ---------------------------------------------------------------------------
// HC de ingreso (mapa de campos del examen físico)
// ---------------------------------------------------------------------------

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
  'IdPersonal',
  'Matricula',
  'Fecha',
  'FechaFormateada',
  'HoraFormateada',
  'ProfesionalNombre',
  'SectorDescripcion',
  'MotivoConsulta',
  'EnfermedadActual',
]);

const HCI_CAMPOS_TEXTO_LIBRE = {
  ModMedica: 'Modificación médica',
  Semiologia: 'Semiología',
  IMPRESIONDIAGNOSTICA: 'Impresión diagnóstica',
  COMENTARIODEINGRESO: 'Comentario de ingreso',
  EXAMENCOMPLEMENTARIO: 'Exámenes complementarios',
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

const HCI_LABEL_WORDS = [
  'HEMIDIAFRAGMAS',
  'SENOSCOSTOFRENICOS',
  'CAMPOSPULMONARES',
  'CIRCULACIONCOLATERAL',
  'ESTADONUTRICIONAL',
  'IMPRESIONGENERAL',
  'PESOHABITUAL',
  'PESOACTUAL',
  'SILUETACARDIO',
  'CONCLUSIONES',
  'LINFANGITIS',
  'ADENOMEGALIAS',
  'NUTRICIONAL',
  'PULMONARES',
  'CIRCULACION',
  'COLATERAL',
  'IMPRESION',
  'GENERAL',
  'HABITUAL',
  'ACTUAL',
  'ESTADO',
  'CAMPOS',
  'SILUETA',
  'CARDIO',
  'SENOS',
  'PESO',
];

function hciTitleWords(s) {
  return String(s || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function hciSplitAllCaps(blob) {
  const words = HCI_LABEL_WORDS.slice().sort((a, b) => b.length - a.length);
  let rest = String(blob || '').toUpperCase();
  const parts = [];
  while (rest) {
    const hit = words.find((w) => rest.startsWith(w));
    if (hit) {
      parts.push(hit);
      rest = rest.slice(hit.length);
      continue;
    }
    parts.push(rest);
    break;
  }
  return parts.join(' ');
}

function hciLabelCampo(key) {
  const norm = String(key || '').toUpperCase();
  const sinPrefijo = norm.replace(/^[A-Z]+_/, '');
  if (!sinPrefijo) return norm;
  if (sinPrefijo.includes('_')) return hciTitleWords(sinPrefijo.replace(/_/g, ' '));
  return hciTitleWords(hciSplitAllCaps(sinPrefijo));
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

// ---------------------------------------------------------------------------
// Bloques clínicos
// ---------------------------------------------------------------------------

function valorControl(v, decimales = null) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n) || n === 0) return '';
  return decimales != null ? n.toFixed(decimales) : String(n);
}

function ordenar(rows, key) {
  return [...(rows || [])].sort((a, b) => key(a).localeCompare(key(b)));
}

function tipoIndicacion(r) {
  const t = str(r.tipo).trim().toUpperCase();
  const prompt = str(r.promptCodigo).toUpperCase();
  if (prompt.includes('MEDIC') || t === 'M') return 'Medicamento';
  if (prompt.includes('DIET') || t === 'D') return 'Dieta';
  if (prompt) return prompt.charAt(0) + prompt.slice(1).toLowerCase();
  return 'Otra';
}

function estadoIndicacion(r) {
  if (r.suspendida) return 'Dejada sin efecto';
  if (r.unicaVez) return 'Única vez';
  return 'Vigente';
}

function renderAdmision(doc, a) {
  sectionTitle(doc, 'Datos de admisión');
  fieldGrid(doc, [
    ['Nº de visita', a.NumeroVisita],
    ['Nº de internación', a.NumeroInternacion],
    ['Clase de paciente', a.ClasePacienteDescripcion || a.ClasePaciente],
    ['Tipo de paciente', a.TipoPacienteDescripcion || a.TipoPaciente],
    ['Tipo de admisión', a.TipoAdmisionDescripcion || a.TipoAdmision],
    ['Origen', a.OrigenAdmisionDescripcion],
    ['Lugar del episodio', a.LugarEpisodioDescripcion],
    ['Estado ambulatorio', a.EstadoAmbulatorioDescripcion],
    ['Sexo', a.SexoDescripcion],
    ['Cobertura', a.CoberturaOS],
    ['Plan / convenio', a.ContratoDescripcion],
    ['Nº de afiliado', a.NumeroSSN],
    ['Médico admisor', a.DoctorAdmisorNombre],
    ['Médico asistente', a.DoctorAsistiendoNombre],
    ['Médico de cabecera', a.DoctorCabeceraNombre],
    ['Servicio', a.ServicioHospitalDescripcion || a.ServicioHospital],
    ['Sector', a.SectorDescripcion || a.Sector],
    ['Habitación / cama', a.Habitacion],
    ['Ingreso', fmtFechaHora(a.FechaAdmision, a.HoraAdmision)],
    ['Egreso', a.FechaEgreso ? fmtFechaHora(a.FechaEgreso, a.HoraEgreso) : 'Sin egreso'],
    ['Días de estadía', a.DiasEstadia],
    ['Disposición de egreso', a.DisposicionEgresoDescripcion],
    ['Diagnóstico de ingreso', [a.Diagnostico, a.DiagnosticoDescripcion].filter(Boolean).join(' — ')],
    ['Diagnóstico de egreso', [a.DiagnosticoEgreso, a.DiagnosticoEgresoDescripcion].filter(Boolean).join(' — ')],
    ['Egreso registrado por', a.OperadorEgresoNombre],
    ['Centro de salud', a.CentroSalud],
  ]);
  doc.moveDown(0.6);
}

function renderMovimientos(doc, rows) {
  const ts = (m) => `${str(m.FechaAdmisionISO)} ${str(m.HoraAdmisionISO)}`;
  const list = ordenar(rows, ts);
  sectionTitle(doc, 'Movimientos de cama', list.length);
  const last = list.length - 1;
  table(
    doc,
    [
      { label: 'Tipo', width: 0.1, value: (m) => (list.indexOf(m) === 0 ? 'Ingreso' : 'Traslado') },
      { label: 'Cama', width: 0.12, value: (m) => str(m.NombreCama || m.ValorHabitacionCama) },
      { label: 'Sector / servicio', width: 0.18, value: (m) => [str(m.NombreSector || m.ValorSector), str(m.NombreServicio)].filter(Boolean).join('\n') },
      { label: 'Desde', width: 0.12, value: (m) => fmtFechaHora(m.FechaAdmisionISO, m.HoraAdmisionISO) },
      {
        label: 'Hasta',
        width: 0.15,
        value: (m) => {
          const hasta = fmtFechaHora(m.FechaEgresoISO, m.HoraEgresoISO);
          if (!hasta) return list.indexOf(m) === last ? 'Actual' : '';
          const disp = str(m.DisposicionEgresoDescripcion);
          return disp && list.indexOf(m) === last ? `${hasta}\n${disp}` : hasta;
        },
      },
      { label: 'Diagnóstico', width: 0.18, value: (m) => str(m.DiagnosticoDescripcion || m.Diagnostico) },
      { label: 'Operador', width: 0.15, value: (m) => str(m.OperadorNombre) },
    ],
    list,
  );
}

function renderHci(doc, rows, firmas) {
  sectionTitle(doc, 'Historia clínica de ingreso', rows.length);
  rows.forEach((row) => {
    recordHeader(
      doc,
      'HC de ingreso',
      [fmtFechaHora(row.FechaFormateada || row.Fecha, row.HoraFormateada), str(row.SectorDescripcion)]
        .filter(Boolean)
        .join(' · '),
    );
    textBlock(doc, 'Motivo de consulta', row.MotivoConsulta);
    textBlock(doc, 'Enfermedad actual', row.EnfermedadActual);
    Object.entries(HCI_CAMPOS_TEXTO_LIBRE).forEach(([field, label]) => textBlock(doc, label, row[field]));
    buildHcDisplaySections(row).forEach((sec) => {
      ensureSpace(doc, 30);
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.brand).text(sec.titulo, left(doc), doc.y, { width: cw(doc) });
      doc.moveDown(0.1);
      fieldGrid(
        doc,
        sec.campos.map((c) => [c.label, c.valor]),
        3,
      );
    });
    drawSignatures(doc, [firmante.hci(row)], firmas);
    recordEnd(doc);
  });
}

function renderIndicaciones(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.vigenteDesde)} ${str(r.horaCarga)} ${String(r.nroIndicacion).padStart(8, '0')}`);
  sectionTitle(doc, 'Indicaciones médicas', list.length);
  table(
    doc,
    [
      { label: 'Nº', width: 0.06, value: (r) => str(r.nroIndicacion) },
      { label: 'Indicada', width: 0.11, value: (r) => fmtFechaHora(r.vigenteDesde, r.horaCarga) },
      { label: 'Tipo', width: 0.1, value: tipoIndicacion },
      {
        label: 'Indicación',
        width: 0.34,
        value: (r) => {
          const desc = str(r.descripcion).trim();
          const med = str(r.medicamento).trim();
          const dosis = [str(r.cantidad), str(r.tipoUnidad)].filter(Boolean).join(' ');
          const lines = [desc || med];
          if (med && desc && med !== desc) lines.push(med);
          if (dosis && Number(r.cantidad) > 0) lines.push(`Dosis: ${dosis}`);
          (r.indicacionesHijas || []).forEach((h) => {
            const hd = [str(h.descripcion || h.medicamento), [str(h.cantidad), str(h.tipoUnidad)].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' · ');
            if (hd) lines.push(`+ ${hd}`);
          });
          if (str(r.observaciones).trim()) lines.push(`Obs.: ${str(r.observaciones).trim()}`);
          return lines.filter(Boolean).join('\n');
        },
      },
      { label: 'Frecuencia', width: 0.11, value: (r) => str(r.frecuencia) },
      { label: 'Estado', width: 0.09, value: estadoIndicacion },
      { label: 'Indicó', width: 0.19, value: (r) => profesionalCelda(firmante.indicacion(r)) },
    ],
    list,
  );
  drawSignatures(doc, list.map(firmante.indicacion), firmas, {
    caption: 'Firmas de los profesionales que indicaron.',
  });
  doc.moveDown(0.4);
}

function renderEstudios(doc, rows, firmas) {
  const list = ordenar(rows, (r) => str(r.FechaPedido || r.fechaPedido));
  sectionTitle(doc, 'Estudios solicitados', list.length);
  list.forEach((ex, i) => {
    const titulo =
      str(ex.PracticaDescripcion || ex.practicaDescripcion) || `Pedido #${str(ex.IdPedido || ex.id || i + 1)}`;
    recordHeader(
      doc,
      titulo,
      [fmtFechaHora(ex.FechaPedido || ex.fechaPedido), str(ex.EstadoUrgencia || ex.estadoUrgencia)].filter(Boolean).join(' · '),
    );
    const sol = firmante.estudioSolicitante(ex);
    const real = firmante.estudioRealizador(ex);
    fieldGrid(doc, [
      ['Solicitó', profesionalCelda(sol).replace('\n', ' · ')],
      ['Realizó', profesionalCelda(real).replace('\n', ' · ')],
      ['Nº protocolo', ex.NroProtocolo || ex.nroProtocolo],
      ['Fecha de resultado', fmtFechaHora(ex.FechaResultado || ex.fechaResultado)],
    ]);
    textBlock(doc, 'Pedido', ex.PedidoEstudio || ex.pedidoEstudio);
    const resultado = ex.ResultadoEstudio || ex.resultadoEstudio;
    if (plain(resultado)) textBlock(doc, 'Resultado', resultado);
    else mutedLine(doc, 'Sin resultado cargado.');
    if (Number(ex.cantidadAdjuntos) > 0) mutedLine(doc, `${ex.cantidadAdjuntos} archivo(s) adjunto(s) al estudio.`);
    drawSignatures(doc, [real || sol], firmas);
    recordEnd(doc);
  });
}

function renderInterconsultas(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.FechaSolicitud)} ${str(r.HoraSolicitud)}`);
  sectionTitle(doc, 'Interconsultas', list.length);
  list.forEach((ic) => {
    const destino = str(ic.ServicioDescripcion || ic.SectorReceptorNombre || ic.Especialidad) || 'Interconsulta';
    const estado = str(ic.EstadoWorkflow || ic.Estado);
    recordHeader(
      doc,
      `Interconsulta a ${destino}`,
      [fmtFechaHora(ic.FechaSolicitud, ic.HoraSolicitud), estado, str(ic.EstadoUrgencia)].filter(Boolean).join(' · '),
    );
    const sol = firmante.interSolicitante(ic);
    const resp = firmante.interRespuesta(ic);
    fieldGrid(doc, [
      ['Solicitó', profesionalCelda(sol).replace('\n', ' · ')],
      ['Sector solicitante', ic.SectorSolicitanteNombre],
      ['Respondió', profesionalCelda(resp).replace('\n', ' · ')],
      ['Fecha de respuesta', fmtFechaHora(ic.FechaRespuesta)],
    ]);
    textBlock(doc, 'Motivo', ic.Motivo);
    if (plain(ic.Respuesta)) textBlock(doc, 'Respuesta', ic.Respuesta);
    else mutedLine(doc, 'Sin respuesta cargada.');
    drawSignatures(
      doc,
      [sol && { ...sol, rol: 'Solicita' }, resp && { ...resp, rol: 'Responde' }].filter(Boolean),
      firmas,
    );
    recordEnd(doc);
  });
}

function renderProtocolos(doc, rows, firmas) {
  const list = ordenar(rows, (r) => str(r.fecha || r.fechaHoraInicio));
  sectionTitle(doc, 'Protocolos', list.length);
  list.forEach((p) => {
    const tipo = str(p.tipoDescripcion || p.tipoProtocolo) || 'Protocolo';
    recordHeader(
      doc,
      `${tipo}${p.numeroProtocolo != null ? ` · Nº ${p.numeroProtocolo}` : ''}`,
      [fmtFechaHora(p.fecha), str(p.estado)].filter(Boolean).join(' · '),
    );
    const practicas = Array.isArray(p.practicas) ? p.practicas : [];
    const equipo = practicas
      .flatMap((x) => (Array.isArray(x.profesionales) ? x.profesionales : []))
      .map((pr) => [str(pr.apellidoNombre), str(pr.funcionNombre) && `(${str(pr.funcionNombre)})`].filter(Boolean).join(' '))
      .filter(Boolean);
    fieldGrid(doc, [
      ['Inicio', fmtFechaHora(p.fechaHoraInicio)],
      ['Fin', fmtFechaHora(p.fechaHoraFin)],
      ['Diagnóstico pre', p.diagnosticoPre],
      ['Diagnóstico post', p.diagnosticoPos],
    ]);
    if (equipo.length) fieldGrid(doc, [['Equipo', [...new Set(equipo)].join(' · ')]], 1);
    if (practicas.length) {
      fieldGrid(
        doc,
        [['Prácticas', practicas.map((x) => [str(x.codigoPractica), str(x.descripcion)].filter(Boolean).join(' ')).join(' · ')]],
        1,
      );
    }
    const meds = Array.isArray(p.medicamentos) ? p.medicamentos : [];
    if (meds.length) {
      fieldGrid(
        doc,
        [['Medicación', meds.map((m) => [str(m.descripcion), [str(m.cantidad), str(m.unidad)].filter(Boolean).join(' ')].filter(Boolean).join(' ')).join(' · ')]],
        1,
      );
    }
    textBlock(doc, 'Técnica', p.tecnica);
    textBlock(doc, 'Descripción', p.texto);
    drawSignatures(doc, [firmante.protocolo(p)], firmas);
    recordEnd(doc);
  });
}

function renderProcedimientos(doc, rows) {
  const list = ordenar(rows, (r) => `${str(r.FechaPractica)} ${str(r.HoraPracticaInicio)}`);
  sectionTitle(doc, 'Procedimientos / prácticas', list.length);
  table(
    doc,
    [
      { label: 'Fecha', width: 0.12, value: (p) => fmtFechaHora(p.FechaPractica, p.HoraPracticaInicio) },
      { label: 'Código', width: 0.09, value: (p) => str(p.Practica) },
      { label: 'Práctica', width: 0.33, value: (p) => str(p.PracticaDescripcion || p.Practica) },
      { label: 'Cant.', width: 0.06, value: (p) => str(p.CantidadPractica), align: 'right' },
      { label: 'Sector', width: 0.1, value: (p) => str(p.ValorSector) },
      {
        label: 'Profesionales',
        width: 0.3,
        value: (p) => (Array.isArray(p.ProfesionalesLista) && p.ProfesionalesLista.length ? p.ProfesionalesLista.join('\n') : str(p.Profesionales)),
      },
    ],
    list,
  );
}

function renderEvoluciones(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.FechaEv)} ${str(r.HoraEv)}`);
  sectionTitle(doc, 'Evoluciones médicas', list.length);
  list.forEach((e) => {
    recordHeader(
      doc,
      str(e.EspecialidadDescripcion || e.SectorDescripcion) || 'Evolución',
      fmtFechaHora(e.FechaEv, e.HoraEv),
    );
    if (plain(e.Evolucion)) textBlock(doc, null, e.Evolucion);
    else mutedLine(doc, 'Sin texto.');
    if (valorControl(e.Glucemia)) fieldGrid(doc, [['Glucemia', e.Glucemia]], 1);
    drawSignatures(doc, [firmante.evolucion(e)], firmas);
    recordEnd(doc);
  });
}

function renderEpicrisis(doc, rows, firmas) {
  sectionTitle(doc, 'Epicrisis', rows.length);
  rows.forEach((ep) => {
    recordHeader(
      doc,
      'Epicrisis',
      [fmtFechaHora(ep.Fecha || ep.fecha, ep.Hora || ep.hora), str(ep.SectorDescripcion || ep.sectorDescripcion)]
        .filter(Boolean)
        .join(' · '),
    );
    fieldGrid(doc, [['Diagnóstico', ep.Diagnostico || ep.diagnostico]], 1);
    textBlock(doc, 'Diagnóstico (detalle)', ep.DiagnosticoText || ep.diagnosticoText);
    textBlock(doc, 'Resumen de la internación', ep.Epicrisis || ep.epicrisis);
    drawSignatures(doc, [firmante.epicrisis(ep)], firmas);
    recordEnd(doc);
  });
}

function renderLaboratorios(doc, rows) {
  sectionTitle(doc, 'Laboratorio', rows.length);
  rows.forEach((ex) => {
    recordHeader(
      doc,
      str(ex.TipoEstudio) || 'Análisis',
      [fmtFechaHora(ex.FechaExamen, ex.HoraExamen), ex.Protocolo ? `Protocolo ${ex.Protocolo}` : '', str(ex.Laboratorio)]
        .filter(Boolean)
        .join(' · '),
    );
    const det = Array.isArray(ex.detalles) ? ex.detalles : [];
    if (det.length) {
      table(
        doc,
        [
          { label: 'Parámetro', width: 0.4, value: (d) => str(d.NombreParametro) },
          { label: 'Resultado', width: 0.25, value: (d) => [str(d.Resultado), str(d.Unidad)].filter(Boolean).join(' ') },
          { label: 'Referencia', width: 0.35, value: (d) => str(d.ValorReferencia) },
        ],
        det,
      );
    } else {
      mutedLine(doc, 'Sin parámetros cargados.');
    }
    recordEnd(doc);
  });
}

function renderControles(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.FechaControl)} ${str(r.HoraControl)}`);
  sectionTitle(doc, 'Controles de enfermería', list.length);
  table(
    doc,
    [
      { label: 'Fecha / hora', width: 0.11, value: (c) => fmtFechaHora(c.FechaControl, c.HoraControl) },
      {
        label: 'TA',
        width: 0.08,
        value: (c) => (valorControl(c.Maximo) ? `${valorControl(c.Maximo)}/${valorControl(c.Minimo) || '—'}` : ''),
      },
      { label: 'FC', width: 0.05, value: (c) => valorControl(c.Pulso), align: 'right' },
      { label: 'FR', width: 0.05, value: (c) => valorControl(c.FrecuenciaRespiratoria), align: 'right' },
      { label: 'T°', width: 0.06, value: (c) => valorControl(c.Axilar, 1) || valorControl(c.Rectal, 1), align: 'right' },
      { label: 'Sat %', width: 0.06, value: (c) => valorControl(c.Saturometria), align: 'right' },
      { label: 'HGT', width: 0.06, value: (c) => str(c.Hgt).trim(), align: 'right' },
      { label: 'Peso', width: 0.06, value: (c) => valorControl(c.Peso, 1), align: 'right' },
      { label: 'Observaciones', width: 0.27, value: (c) => str(c.Observaciones).trim() },
      { label: 'Registró', width: 0.2, value: (c) => profesionalCelda(firmante.control(c)) },
    ],
    list,
  );
  drawSignatures(doc, list.map(firmante.control), firmas, { caption: 'Firmas de los responsables de los controles.' });
  doc.moveDown(0.4);
}

function renderMedicacion(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.FechaControl)} ${str(r.HoraControl)}`);
  sectionTitle(doc, 'Medicación suministrada', list.length);
  table(
    doc,
    [
      { label: 'Fecha / hora', width: 0.12, value: (m) => fmtFechaHora(m.FechaControl, m.HoraControl) },
      {
        label: 'Medicamento',
        width: 0.34,
        value: (m) => {
          const lines = [str(m.NombreMedicamento || m.DescripcionMedicamento)];
          (m.adicionales || []).forEach((a) => {
            const t = [str(a.NombreMedicamento || a.DescripcionMedicamento), [str(a.Cantidad), str(a.TipoUnidad)].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' · ');
            if (t) lines.push(`+ ${t}`);
          });
          return lines.filter(Boolean).join('\n');
        },
      },
      { label: 'Cantidad', width: 0.1, value: (m) => [str(m.Cantidad), str(m.TipoUnidad)].filter(Boolean).join(' ') },
      { label: 'Ind. Nº', width: 0.07, value: (m) => str(m.NroIndicacion), align: 'right' },
      { label: 'Observaciones', width: 0.17, value: (m) => str(m.Observaciones).trim() },
      { label: 'Suministró', width: 0.2, value: (m) => profesionalCelda(firmante.medicacion(m)) },
    ],
    list,
  );
  drawSignatures(doc, list.map(firmante.medicacion), firmas, { caption: 'Firmas de quienes suministraron la medicación.' });
  doc.moveDown(0.4);
}

function renderDietas(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.FechaDieta || r.FechaCarga)} ${str(r.HoraDieta || r.HoraCarga)}`);
  sectionTitle(doc, 'Dietas', list.length);
  table(
    doc,
    [
      { label: 'Fecha / hora', width: 0.13, value: (d) => fmtFechaHora(d.FechaDieta || d.FechaCarga, d.HoraDieta || d.HoraCarga) },
      { label: 'Dieta', width: 0.27, value: (d) => str(d.DescripcionDieta) },
      { label: 'Estado', width: 0.1, value: (d) => (d.FechaDieta ? 'Suministrada' : 'Indicada') },
      { label: 'Ind. Nº', width: 0.07, value: (d) => str(d.NroIndicacion), align: 'right' },
      { label: 'Observaciones', width: 0.23, value: (d) => str(d.Observaciones).trim() },
      { label: 'Registró', width: 0.2, value: (d) => profesionalCelda(firmante.dieta(d)) },
    ],
    list,
  );
  drawSignatures(doc, list.map(firmante.dieta), firmas);
  doc.moveDown(0.4);
}

function renderBalance(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.Fecha)} ${str(r.Hora)}`);
  sectionTitle(doc, 'Balance hídrico', list.length);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const tot = list.reduce(
    (acc, b) => ({ i: acc.i + num(b.TotalIngresos), e: acc.e + num(b.TotalEgresos), t: acc.t + num(b.Total) }),
    { i: 0, e: 0, t: 0 },
  );
  table(
    doc,
    [
      { label: 'Fecha / hora', width: 0.12, value: (b) => fmtFechaHora(b.Fecha, b.Hora) },
      { label: 'Medicación / vía', width: 0.24, value: (b) => [str(b.Medicacion), str(b.Via)].filter(Boolean).join(' · ') },
      { label: 'Ingresos (ml)', width: 0.1, value: (b) => str(b.TotalIngresos), align: 'right' },
      { label: 'Egresos (ml)', width: 0.1, value: (b) => str(b.TotalEgresos), align: 'right' },
      { label: 'Balance (ml)', width: 0.1, value: (b) => str(b.Total), align: 'right' },
      { label: 'Sector', width: 0.1, value: (b) => str(b.Sector) },
      { label: 'Registró', width: 0.24, value: (b) => profesionalCelda(firmante.balance(b)) },
    ],
    list,
    { footer: ['Total', '', String(tot.i), String(tot.e), String(tot.t), '', ''] },
  );
  drawSignatures(doc, list.map(firmante.balance), firmas);
  doc.moveDown(0.4);
}

function renderEvolucionEnfermeria(doc, rows, firmas) {
  const list = ordenar(rows, (r) => `${str(r.FechaControl)} ${str(r.HoraControl)}`);
  sectionTitle(doc, 'Evolución de enfermería', list.length);
  list.forEach((e) => {
    recordHeader(doc, 'Evolución de enfermería', fmtFechaHora(e.FechaControl, e.HoraControl));
    if (plain(e.Observaciones)) textBlock(doc, null, e.Observaciones);
    else mutedLine(doc, 'Sin texto.');
    drawSignatures(doc, [firmante.evolucionEnf(e)], firmas);
    recordEnd(doc);
  });
}

function renderInsumos(doc, rows) {
  const list = ordenar(rows, (r) => `${str(r.vigenteDesde)} ${str(r.horaCarga)}`);
  sectionTitle(doc, 'Insumos', list.length);
  table(
    doc,
    [
      { label: 'Fecha / hora', width: 0.13, value: (r) => fmtFechaHora(r.vigenteDesde, r.horaCarga) },
      { label: 'Insumo', width: 0.37, value: (r) => str(r.descripcion || r.medicamento).trim() },
      { label: 'Cant.', width: 0.07, value: (r) => str(r.cantidad), align: 'right' },
      { label: 'Observaciones', width: 0.21, value: (r) => str(r.observaciones).trim() },
      { label: 'Cargó', width: 0.22, value: (r) => str(r.fullName) },
    ],
    list,
  );
}

// ---------------------------------------------------------------------------
// Adjuntos
// ---------------------------------------------------------------------------

async function prepareAdjuntosResueltos(adjuntosMeta) {
  const list = Array.isArray(adjuntosMeta) ? adjuntosMeta : [];
  const out = await Promise.all(
    list.map(async (a) => {
      const id = a.IdAdjunto;
      const fetched = await adjuntosService.fetchAdjuntoFileBuffer(id);
      const nombre = fetched.nombreArchivo || a.NombreArchivo || 'archivo';
      const ext = path.extname(nombre).toLowerCase();
      let kind = 'none';
      const buffer = fetched.buffer;
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
    }),
  );
  return out;
}

function renderAdjuntos(doc, adjuntosResueltos, pdfAnnexBuffers) {
  sectionTitle(doc, 'Adjuntos', adjuntosResueltos.length);
  table(
    doc,
    [
      { label: 'Archivo', width: 0.42, value: (a) => str(a.nombreArchivo) },
      { label: 'Tipo', width: 0.2, value: (a) => str(a.meta?.TipoImagenNombre || a.ext.replace('.', '').toUpperCase()) },
      { label: 'Cargado', width: 0.15, value: (a) => fmtFechaHora(a.meta?.FechaCarga) },
      {
        label: 'En este PDF',
        width: 0.23,
        value: (a) =>
          a.kind === 'pdf'
            ? 'Anexado al final'
            : a.kind === 'image'
              ? 'Página siguiente'
              : a.kind === 'unsupported'
                ? 'Formato no incrustable'
                : 'No se pudo obtener',
      },
    ],
    adjuntosResueltos,
  );

  adjuntosResueltos.forEach((adj) => {
    if (adj.kind === 'pdf' && adj.buffer) {
      pdfAnnexBuffers.push(adj.buffer);
      return;
    }
    if (adj.kind !== 'image' || !adj.buffer) return;
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text).text(str(adj.nombreArchivo), left(doc), doc.y, { width: cw(doc) });
    doc.moveDown(0.3);
    try {
      const top = doc.y;
      const fh = Math.max(80, bottomLimit(doc) - top);
      doc.image(adj.buffer, left(doc), top, { fit: [cw(doc), fh], align: 'center', valign: 'center' });
    } catch (e) {
      mutedLine(doc, `No se pudo incrustar la imagen: ${e.message}`, C.danger);
    }
  });
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

const has = (arr) => Array.isArray(arr) && arr.length > 0;

/**
 * @param {object} payload resultado de exportarAdmisionSelectivo (+ `empresa` opcional)
 * @returns {Promise<Buffer>}
 */
async function buildSelectiveExportPdf(payload) {
  const empresa = payload.empresa || null;
  const [adjuntosResueltos, firmas] = await Promise.all([
    has(payload.adjuntos) ? prepareAdjuntosResueltos(payload.adjuntos) : Promise.resolve([]),
    resolverFirmas(todosLosFirmantes(payload)),
  ]);
  const pdfAnnexBuffers = [];
  const a = payload.paciente || payload.admision || null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: MARGINS,
      bufferPages: true,
      info: {
        Title: `Historia clínica · Visita ${payload.numeroVisita || ''}`,
        Subject: str(a?.ApellidoYNombre),
        Author: str(empresa?.razonSocial || empresa?.descripcion) || 'iMedic',
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

    try {
      drawInstitucion(doc, empresa, payload.numeroVisita);
      drawPacienteCard(doc, a, payload.criterios);

      if (payload.admision) renderAdmision(doc, payload.admision);
      if (has(payload.movimientos)) renderMovimientos(doc, payload.movimientos);

      const medica = [
        [payload.historialClinico, () => renderHci(doc, payload.historialClinico, firmas)],
        [payload.indicaciones, () => renderIndicaciones(doc, payload.indicaciones, firmas)],
        [payload.estudios, () => renderEstudios(doc, payload.estudios, firmas)],
        [payload.interconsultas, () => renderInterconsultas(doc, payload.interconsultas, firmas)],
        [payload.protocolos, () => renderProtocolos(doc, payload.protocolos, firmas)],
        [payload.practicasPaciente, () => renderProcedimientos(doc, payload.practicasPaciente)],
        [payload.evolucionesMedicas, () => renderEvoluciones(doc, payload.evolucionesMedicas, firmas)],
        [payload.epicrisis, () => renderEpicrisis(doc, payload.epicrisis, firmas)],
        [payload.practicas?.laboratorios, () => renderLaboratorios(doc, payload.practicas.laboratorios)],
      ].filter(([rows]) => has(rows));

      const enfermeria = [
        [payload.controles, () => renderControles(doc, payload.controles, firmas)],
        [payload.medicamentos, () => renderMedicacion(doc, payload.medicamentos, firmas)],
        [payload.evolucionesEnfermeria, () => renderEvolucionEnfermeria(doc, payload.evolucionesEnfermeria, firmas)],
        [payload.balanceHidrico, () => renderBalance(doc, payload.balanceHidrico, firmas)],
        [payload.dietas, () => renderDietas(doc, payload.dietas, firmas)],
        [payload.insumos, () => renderInsumos(doc, payload.insumos)],
      ].filter(([rows]) => has(rows));

      if (medica.length) {
        groupTitle(doc, 'Gestión médica');
        medica.forEach(([, render]) => render());
      }
      if (enfermeria.length) {
        groupTitle(doc, 'Gestión de enfermería');
        enfermeria.forEach(([, render]) => render());
      }
      if (adjuntosResueltos.length) {
        groupTitle(doc, 'Documentación');
        renderAdjuntos(doc, adjuntosResueltos, pdfAnnexBuffers);
      }

      const algo = medica.length || enfermeria.length || adjuntosResueltos.length || payload.admision || has(payload.movimientos);
      if (!algo) mutedLine(doc, 'No hay registros para los bloques y el período elegidos.');

      drawRunningChrome(doc, payload, empresa);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Une varios PDFs de visitas en uno solo (carpeta / export general).
 * @param {Buffer[]} pdfBuffers
 * @returns {Promise<Buffer>}
 */
async function buildMultiVisitExportPdf(pdfBuffers) {
  const buffers = (pdfBuffers || []).filter((b) => b && b.length);
  if (!buffers.length) {
    const err = new Error('No hay visitas para exportar');
    err.code = 'NO_VISITS';
    throw err;
  }
  if (buffers.length === 1) return buffers[0];
  const mainDoc = await PDFLibDocument.load(buffers[0]);
  for (let i = 1; i < buffers.length; i++) {
    try {
      const annex = await PDFLibDocument.load(buffers[i]);
      const copied = await mainDoc.copyPages(annex, annex.getPageIndices());
      copied.forEach((p) => mainDoc.addPage(p));
    } catch (err) {
      console.warn('[PDF export] Visita omitida en merge:', err.message);
    }
  }
  return Buffer.from(await mainDoc.save());
}

module.exports = {
  buildSelectiveExportPdf,
  buildMultiVisitExportPdf,
};
