const axios = require('axios');
const { executeQuery } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { normalizarTextoParaClarionAnsi, repararTextoClarionAnsi } = require('../utils/clarionText');
const { resolveFileServerUrl, fileServerHeaders } = require('../utils/fileServerUrl');
const { decodeMultipartFilename, sanitizeWindowsFileName, sanitizeFolderName, pathLookupCandidates, normalizeAdjuntoFilePath, fileServerFileUrl, relativeFromLegacyImagenesUnc, toClarionStoredPath, clarionUncRootForFileServerUrl } = require('../utils/fileNameEncoding');

const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);

/** Ruta que el SaaS debe usar para leer (nunca UNC Clarion \\SERVER\Imagenes\Vidal). */
function coercePatchServidorForClinic(ruta, fileServerUrl) {
  const s = String(ruta || '').replace(/\//g, '\\').trim();
  if (!s) return s;
  if (/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\/i.test(s)) return s;
  if (/^[A-Za-z]:\\imagenes\\/i.test(s)) return s;

  const rel = relativeFromLegacyImagenesUnc(s);
  if (rel == null || rel === '') return s;

  const url = String(fileServerUrl || '').toLowerCase();
  if (url.includes('sarmiento')) return `C:\\imedic\\adjuntos\\${rel}`;
  if (url.includes('vidal')) return `E:\\imagenes\\vidal\\${rel}`;
  return rel;
}

const ensureIdTurnoColumn = createTenantOnce(async () => {
  const cols = await executeQuery(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = 'imPedidosEstudiosAdjuntos' AND COLUMN_NAME = 'IdTurno'`,
  );
  if (!cols?.length) {
    await executeQuery(`ALTER TABLE dbo.imPedidosEstudiosAdjuntos ADD IdTurno INT NULL`);
    console.log('[adjuntos] Columna IdTurno agregada a imPedidosEstudiosAdjuntos');
  }
});

class AdjuntosService {
  /**
   * Subir archivo adjunto para una visita y/o turno de agenda (pre-cierre).
   * @param {string} [patchServidor] ruta real del file server (la que usa el SaaS para leer)
   * @param {string} [patchClarion] cortesía Clarion (Patch); si falta, copia patchServidor
   */
  async subirAdjunto(data, file, cargadoPor, patchServidor, patchClarion) {
    try {
      await ensureIdTurnoColumn();
      let fileServerUrl = '';
      try {
        fileServerUrl = await resolveFileServerUrl();
      } catch {
        /* sin URL: no remapear */
      }

      // PatchServidor = ruta real de la clínica (consumo SaaS). Nunca UNC Clarion.
      const rutaServidor = coercePatchServidorForClinic(
        patchServidor || file.path,
        fileServerUrl,
      );
      // Patch = cortesía Clarion (Vidal → \\SERVER\…; Sarmiento → misma ruta local).
      const rutaClarion =
        patchClarion ||
        toClarionStoredPath(rutaServidor, {
          personales: false,
          uncRoot: clarionUncRootForFileServerUrl(fileServerUrl),
        });
      const idTipo =
        data.idTipoImagen != null && String(data.idTipoImagen).trim() !== ''
          ? String(data.idTipoImagen).trim()
          : null;
      const numeroVisita = Number(data.numeroVisita) > 0 ? Number(data.numeroVisita) : 0;
      const idTurno = Number(data.idTurno) > 0 ? Number(data.idTurno) : null;

      const rows = await executeQuery(
        `
          INSERT INTO imPedidosEstudiosAdjuntos
            (NumeroVisita, IdTurno, Descripcion, Patch, PatchServidor, Fecha, IdOperador, idtipoimagen)
          OUTPUT INSERTED.IdAdjunto
          VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)
        `,
        [
          { value: numeroVisita, type: 'Int' },
          { value: idTurno, type: 'Int' },
          {
            value: normalizarTextoParaClarionAnsi(
              sanitizeWindowsFileName(file.originalname),
              { maxLength: 255 },
            ),
            type: 'NVarChar',
          },
          { value: rutaClarion, type: 'NVarChar' },
          { value: rutaServidor, type: 'NVarChar' },
          { value: new Date(), type: 'DateTime' },
          { value: cargadoPor, type: 'Int' },
          { value: idTipo, type: 'VarChar' },
        ],
      );

      const idAdjunto = rows[0]?.IdAdjunto;

      const ref = idTurno ? `turno ${idTurno}` : `visita ${numeroVisita}`;
      console.log(`✅ Adjunto subido para ${ref}: ${idAdjunto} - ${file.originalname}`);
      console.log(`📁 PatchServidor (SaaS): ${rutaServidor}`);
      if (rutaClarion !== rutaServidor) {
        console.log(`📁 Patch (Clarion): ${rutaClarion}`);
      }

      return {
        success: true,
        idAdjunto,
        nombreArchivo: file.originalname,
        rutaArchivo: rutaServidor,
        tipoArchivo: file.mimetype,
        tamanioBytes: file.size,
      };
    } catch (error) {
      console.error('❌ Error al subir adjunto:', error);
      throw error;
    }
  }

  /**
   * Catálogo HCTiposImagenes (código + descripción) para adjuntos.
   */
  async listarTiposImagen() {
    try {
      const rows = await executeQuery(`
        SELECT
          LTRIM(RTRIM(CAST(tipoimagen AS VARCHAR(20)))) AS TipoImagen,
          LTRIM(RTRIM(CAST(desctipoimagen AS VARCHAR(120)))) AS DescTipoImagen
        FROM dbo.hctiposimagenes
        WHERE tipoimagen IS NOT NULL
          AND LTRIM(RTRIM(CAST(tipoimagen AS VARCHAR(20)))) <> ''
        ORDER BY desctipoimagen
      `);
      return (rows || []).map((r) => ({
        TipoImagen: r.TipoImagen,
        DescTipoImagen: r.DescTipoImagen || r.TipoImagen,
      }));
    } catch (error) {
      console.error('❌ Error al listar HCTiposImagenes:', error);
      throw error;
    }
  }

  /**
   * Obtener tipo MIME desde nombre de archivo
   */
  getTipoFromNombre(nombre) {
    const ext = nombre.split('.').pop().toLowerCase();
    const tipos = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      dcm: 'application/dicom',
      dicom: 'application/dicom',
      webm: 'video/webm',
      mp4: 'video/mp4',
    };
    return tipos[ext] || 'application/octet-stream';
  }

  normalizarRutaPatch(rutaOriginal) {
    return normalizeAdjuntoFilePath(rutaOriginal);
  }

  async fetchFileFromServer(rutaBase) {
    const fileServerUrl = await resolveFileServerUrl();
    const candidates = pathLookupCandidates(this.normalizarRutaPatch(rutaBase));
    let lastErr = null;
    for (const ruta of candidates) {
      const url = fileServerFileUrl(fileServerUrl, ruta);
      try {
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: fileServerHeaders(),
          timeout: FILE_SERVER_TIMEOUT_MS,
          maxContentLength: 50 * 1024 * 1024,
          maxBodyLength: 50 * 1024 * 1024,
          validateStatus: (s) => s >= 200 && s < 300,
        });
        const buffer = Buffer.from(res.data);
        if (buffer.length) return { buffer, rutaUsada: ruta };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Archivo no encontrado en el servidor de archivos');
  }

  async deleteFileFromServer(rutaBase) {
    const fileServerUrl = await resolveFileServerUrl();
    const candidates = pathLookupCandidates(this.normalizarRutaPatch(rutaBase));
    let lastErr = null;
    for (const ruta of candidates) {
      const deleteUrl = fileServerFileUrl(fileServerUrl, ruta);
      try {
        const response = await axios.delete(deleteUrl, {
          headers: fileServerHeaders(),
          timeout: 30000,
        });
        if (response.data?.success) return { deleted: true, rutaUsada: ruta };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('No se pudo eliminar el archivo en el servidor de archivos');
  }

  /**
   * Descarga el archivo binario de un adjunto (servidor HTTP de archivos o disco local).
   * @returns {Promise<{ buffer: Buffer | null, nombreArchivo: string, error?: string }>}
   */
  async fetchAdjuntoFileBuffer(idAdjunto) {
    const adj = await this.getAdjuntoPorId(idAdjunto);
    if (!adj?.RutaArchivo) {
      return { buffer: null, nombreArchivo: adj?.NombreArchivo || '', error: 'Sin ruta de archivo' };
    }
    const rutaN = this.normalizarRutaPatch(adj.RutaArchivo);
    const nombreArchivo = adj.NombreArchivo || path.basename(String(adj.RutaArchivo)) || 'adjunto';
    try {
      const { buffer } = await this.fetchFileFromServer(adj.RutaArchivo);
      return { buffer, nombreArchivo };
    } catch (e) {
      const candidates = pathLookupCandidates(rutaN).concat(
        pathLookupCandidates(adj.RutaArchivo),
      );
      for (const p of candidates) {
        try {
          if (fsSync.existsSync(p)) {
            const buffer = await fs.readFile(p);
            return { buffer, nombreArchivo };
          }
        } catch (_) {
          /* siguiente candidato */
        }
      }
      console.warn(`[fetchAdjuntoFileBuffer] id=${idAdjunto}:`, e.message);
      return { buffer: null, nombreArchivo, error: e.message || 'No se pudo leer el archivo' };
    }
  }

  /**
   * Obtener tamaño de archivo
   */
  getFileSize(filePath) {
    try {
      const stats = require('fs').statSync(filePath);
      return stats.size;
    } catch (error) {
      console.warn(`⚠️ No se pudo obtener tamaño del archivo: ${filePath}`);
      return 0;
    }
  }

  mapAdjuntoRow(adj) {
    let nombreArchivo = adj.Descripcion;
    if (!nombreArchivo || !/\.[a-zA-Z0-9]+$/.test(nombreArchivo)) {
      const rutaCompleta = adj.PatchServidor || '';
      nombreArchivo = rutaCompleta.split(/[\\\/]/).pop() || '';
    }
    nombreArchivo = decodeMultipartFilename(nombreArchivo);

    return {
      IdAdjunto: adj.IdAdjunto,
      NumeroVisita: adj.NumeroVisita,
      NombreArchivo: nombreArchivo || 'Sin nombre',
      RutaArchivo: adj.PatchServidor,
      TipoArchivo: this.getTipoFromNombre(nombreArchivo || adj.PatchServidor || ''),
      TamanioBytes: this.getFileSize(adj.PatchServidor),
      IdOperador: adj.IdOperador != null ? Number(adj.IdOperador) : null,
      CargadoPor: adj.IdOperador,
      NombreUsuario: adj.NombreOperador || 'Desconocido',
      FechaCarga: adj.Fecha,
      TipoImagen: adj.idtipoimagen ? String(adj.idtipoimagen).trim() : null,
      TipoImagenNombre: adj.TipoImagenNombre || 'Sin categoría',
    };
  }

  /**
   * Obtener adjuntos de una visita
   */
  async getAdjuntosPorVisita(numeroVisita) {
    try {
      const rows = await executeQuery(
        `
          SELECT 
            a.IdAdjunto,
            a.NumeroVisita,
            a.Descripcion,
            a.PatchServidor,
            a.idtipoimagen,
            LTRIM(RTRIM(t.desctipoimagen)) AS TipoImagenNombre,
            a.Fecha,
            a.IdOperador,
            LTRIM(RTRIM(ISNULL(p.Apellido, '') + ' ' + ISNULL(p.Nombres, ''))) AS NombreOperador
          FROM imPedidosEstudiosAdjuntos a
          LEFT JOIN imPassword p ON a.IdOperador = p.CodOperador
          LEFT JOIN hctiposimagenes t ON a.idtipoimagen = t.tipoimagen
          WHERE a.NumeroVisita = @p0
          ORDER BY a.Fecha DESC
        `,
        [{ value: numeroVisita, type: 'Int' }],
      );

      return (rows || []).map((adj) => this.mapAdjuntoRow(adj));
    } catch (error) {
      console.error('❌ Error al obtener adjuntos por visita:', error);
      throw error;
    }
  }

  /**
   * Adjuntos vinculados a un turno (pre-cierre) o ya migrados a su visita.
   */
  async getAdjuntosPorTurno(idTurno) {
    try {
      await ensureIdTurnoColumn();
      const id = Number(idTurno);
      const rows = await executeQuery(
        `
          SELECT
            a.IdAdjunto,
            a.NumeroVisita,
            a.IdTurno,
            a.Descripcion,
            a.PatchServidor,
            a.idtipoimagen,
            LTRIM(RTRIM(t.desctipoimagen)) AS TipoImagenNombre,
            a.Fecha,
            a.IdOperador,
            LTRIM(RTRIM(ISNULL(p.Apellido, '') + ' ' + ISNULL(p.Nombres, ''))) AS NombreOperador
          FROM imPedidosEstudiosAdjuntos a
          LEFT JOIN imPassword p ON a.IdOperador = p.CodOperador
          LEFT JOIN hctiposimagenes t ON a.idtipoimagen = t.tipoimagen
          WHERE a.IdTurno = @p0
             OR a.NumeroVisita IN (
               SELECT t.NumeroVisita FROM dbo.imTurnos t
               WHERE t.IdTurno = @p0 AND t.NumeroVisita > 0
             )
          ORDER BY a.Fecha DESC
        `,
        [{ value: id, type: 'Int' }],
      );
      return (rows || []).map((adj) => this.mapAdjuntoRow(adj));
    } catch (error) {
      console.error('❌ Error al obtener adjuntos por turno:', error);
      throw error;
    }
  }

  /**
   * Al cerrar turno: asigna NumeroVisita a adjuntos cargados con IdTurno.
   */
  async vincularAdjuntosTurnoAVisita(idTurno, numeroVisita) {
    await ensureIdTurnoColumn();
    const id = Number(idTurno);
    const nv = Number(numeroVisita);
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(nv) || nv <= 0) return { updated: 0 };
    const result = await executeQuery(
      `UPDATE dbo.imPedidosEstudiosAdjuntos
       SET NumeroVisita = @p0
       WHERE IdTurno = @p1 AND (NumeroVisita IS NULL OR NumeroVisita = 0)`,
      [
        { value: nv, type: 'Int' },
        { value: id, type: 'Int' },
      ],
    );
    return { updated: result?.rowsAffected?.[0] ?? 0 };
  }

  async getNombrePacientePorVisita(numeroVisita) {
    const rows = await executeQuery(
      `
      SELECT TOP 1 p.ApellidoYNombre
      FROM imVisita v
      INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
      WHERE v.NumeroVisita = @param0
      `,
      [{ value: parseInt(numeroVisita, 10) }],
    );
    const nombre = rows?.[0]?.ApellidoYNombre;
    if (!nombre) return `PACIENTE_${numeroVisita}`;
    const repaired = repararTextoClarionAnsi(String(nombre).trim());
    return sanitizeFolderName(repaired) || `PACIENTE_${numeroVisita}`;
  }

  async getNombrePacientePorTurno(idTurno) {
    const rows = await executeQuery(
      `SELECT TOP 1 p.ApellidoyNombre
       FROM dbo.imTurnos t
       INNER JOIN dbo.imPacientes p ON p.IDPaciente = t.IDPaciente
       WHERE t.IdTurno = @p0`,
      [{ value: Number(idTurno), type: 'Int' }],
    );
    const nombre = rows?.[0]?.ApellidoyNombre;
    if (!nombre) return `TURNO_${idTurno}`;
    const repaired = repararTextoClarionAnsi(String(nombre).trim());
    return sanitizeFolderName(repaired) || `TURNO_${idTurno}`;
  }

  /**
   * Obtener adjuntos de una visita agrupados por tipo de imagen
   */
  async getAdjuntosAgrupadosPorTipo(numeroVisita) {
    try {
      const adjuntos = await this.getAdjuntosPorVisita(numeroVisita);

      const grupos = {};

      adjuntos.forEach((adj) => {
        const nombreTipo = adj.TipoImagenNombre || 'Sin categoría';
        if (!grupos[nombreTipo]) {
          grupos[nombreTipo] = {
            tipo: adj.TipoImagen,
            nombre: nombreTipo,
            adjuntos: [],
            cantidad: 0,
          };
        }
        grupos[nombreTipo].adjuntos.push(adj);
        grupos[nombreTipo].cantidad++;
      });

      return Object.values(grupos).sort((a, b) => b.cantidad - a.cantidad);
    } catch (error) {
      console.error('❌ Error al obtener adjuntos agrupados:', error);
      throw error;
    }
  }

  /**
   * Obtener un adjunto por ID
   */
  async getAdjuntoPorId(idAdjunto) {
    try {
      const rows = await executeQuery(
        `
          SELECT 
            a.IdAdjunto,
            a.NumeroVisita,
            a.Descripcion,
            a.PatchServidor,
            a.Fecha,
            a.IdOperador,
            LTRIM(RTRIM(ISNULL(p.Apellido, '') + ' ' + ISNULL(p.Nombres, ''))) AS NombreOperador
          FROM imPedidosEstudiosAdjuntos a
          LEFT JOIN imPassword p ON a.IdOperador = p.CodOperador
          WHERE a.IdAdjunto = @p0
        `,
        [{ value: idAdjunto, type: 'Int' }],
      );

      if (!rows?.length) {
        return null;
      }

      const adj = rows[0];
      const mapped = this.mapAdjuntoRow({ ...adj, idtipoimagen: null, TipoImagenNombre: null });
      delete mapped.TipoImagen;
      delete mapped.TipoImagenNombre;
      return mapped;
    } catch (error) {
      console.error('❌ Error al obtener adjunto por ID:', error);
      throw error;
    }
  }

  /**
   * Eliminar adjunto
   */
  async eliminarAdjunto(idAdjunto, usuarioId) {
    try {
      const adjunto = await this.getAdjuntoPorId(idAdjunto);

      if (!adjunto) {
        throw new Error('Adjunto no encontrado');
      }

      if (adjunto.RutaArchivo) {
        try {
          console.log(`🗑️ Eliminando archivo del servidor: ${adjunto.RutaArchivo}`);
          const result = await this.deleteFileFromServer(adjunto.RutaArchivo);
          console.log(`✅ Archivo físico eliminado: ${result.rutaUsada}`);
        } catch (fileError) {
          console.warn(`⚠️ No se pudo eliminar archivo físico: ${adjunto.RutaArchivo}`);
          console.warn(`   Error: ${fileError.message}`);
        }
      }

      await executeQuery('DELETE FROM imPedidosEstudiosAdjuntos WHERE IdAdjunto = @p0', [
        { value: idAdjunto, type: 'Int' },
      ]);

      console.log(`✅ Adjunto eliminado de BD: ${idAdjunto}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error al eliminar adjunto:', error);
      throw error;
    }
  }
}

module.exports = new AdjuntosService();
