const axios = require('axios');
const { executeQuery } = require('../models/db');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || 'http://181.4.71.230:3002';
const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);

class AdjuntosService {
  /**
   * Subir archivo adjunto para una visita
   */
  async subirAdjunto(data, file, cargadoPor, patchServidor) {
    try {
      const rutaArchivo = patchServidor || file.path;
      const idTipo =
        data.idTipoImagen != null && String(data.idTipoImagen).trim() !== ''
          ? String(data.idTipoImagen).trim()
          : null;

      const rows = await executeQuery(
        `
          INSERT INTO imPedidosEstudiosAdjuntos (NumeroVisita, Descripcion, Patch, PatchServidor, Fecha, IdOperador, idtipoimagen)
          OUTPUT INSERTED.IdAdjunto
          VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)
        `,
        [
          { value: data.numeroVisita, type: 'Int' },
          {
            value: normalizarTextoParaClarionAnsi(file.originalname, { maxLength: 255 }),
            type: 'NVarChar',
          },
          { value: rutaArchivo, type: 'NVarChar' },
          { value: rutaArchivo, type: 'NVarChar' },
          { value: new Date(), type: 'DateTime' },
          { value: cargadoPor, type: 'Int' },
          { value: idTipo, type: 'VarChar' },
        ],
      );

      const idAdjunto = rows[0]?.IdAdjunto;

      console.log(`✅ Adjunto subido para visita ${data.numeroVisita}: ${idAdjunto} - ${file.originalname}`);
      console.log(`📁 Ruta en servidor: ${rutaArchivo}`);

      return {
        success: true,
        idAdjunto,
        nombreArchivo: file.originalname,
        rutaArchivo: rutaArchivo,
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
    };
    return tipos[ext] || 'application/octet-stream';
  }

  normalizarRutaPatch(rutaOriginal) {
    if (!rutaOriginal) return rutaOriginal;
    let ruta = rutaOriginal;
    if (ruta.startsWith('D:\\')) ruta = ruta.replace(/^D:\\/, 'E:\\');
    if (ruta.startsWith('F:\\')) ruta = ruta.replace(/^F:\\/, 'E:\\');
    return ruta;
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
      const url = `${FILE_SERVER_URL}/file?path=${encodeURIComponent(rutaN)}`;
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: FILE_SERVER_TIMEOUT_MS,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
      });
      const buffer = Buffer.from(res.data);
      if (!buffer.length) {
        return { buffer: null, nombreArchivo, error: 'Archivo vacío en el servidor de archivos' };
      }
      return { buffer, nombreArchivo };
    } catch (e) {
      const candidates = [rutaN, adj.RutaArchivo].filter((p) => typeof p === 'string' && p.length > 0);
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

    return {
      IdAdjunto: adj.IdAdjunto,
      NumeroVisita: adj.NumeroVisita,
      NombreArchivo: nombreArchivo || 'Sin nombre',
      RutaArchivo: adj.PatchServidor,
      TipoArchivo: this.getTipoFromNombre(nombreArchivo || adj.PatchServidor || ''),
      TamanioBytes: this.getFileSize(adj.PatchServidor),
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
          const encodedPath = encodeURIComponent(adjunto.RutaArchivo);
          const deleteUrl = `${FILE_SERVER_URL}/file?path=${encodedPath}`;

          console.log(`🗑️ Eliminando archivo del servidor: ${adjunto.RutaArchivo}`);

          const response = await axios.delete(deleteUrl, {
            timeout: 30000,
          });

          if (response.data.success) {
            console.log(`✅ Archivo físico eliminado: ${adjunto.RutaArchivo}`);
          } else {
            console.warn(`⚠️ Respuesta del servidor: ${response.data.message || 'Error desconocido'}`);
          }
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
