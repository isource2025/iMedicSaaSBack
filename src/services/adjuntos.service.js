const sql = require('mssql');
const axios = require('axios');
const { connectDB } = require('../config/database');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

const FILE_SERVER_URL = process.env.FILE_SERVER_URL || 'http://181.4.71.230:3002';

class AdjuntosService {
  /**
   * Subir archivo adjunto para una visita
   */
  async subirAdjunto(data, file, cargadoPor, patchServidor) {
    try {
      const pool = await connectDB();

      // Usar patchServidor (ruta en servidor SQL) en lugar de file.path (ruta local temporal)
      const rutaArchivo = patchServidor || file.path;
      const idTipo =
        data.idTipoImagen != null && String(data.idTipoImagen).trim() !== ''
          ? String(data.idTipoImagen).trim()
          : null;

      const result = await pool.request()
        .input('numeroVisita', sql.Int, data.numeroVisita)
        .input('descripcion', sql.NVarChar(255), file.originalname)
        .input('patch', sql.NVarChar(500), rutaArchivo)
        .input('patchServidor', sql.NVarChar(500), rutaArchivo)
        .input('fecha', sql.DateTime, new Date())
        .input('idOperador', sql.Int, cargadoPor)
        .input('idtipoimagen', sql.VarChar(20), idTipo)
        .query(`
          INSERT INTO imPedidosEstudiosAdjuntos (NumeroVisita, Descripcion, Patch, PatchServidor, Fecha, IdOperador, idtipoimagen)
          OUTPUT INSERTED.IdAdjunto
          VALUES (@numeroVisita, @descripcion, @patch, @patchServidor, @fecha, @idOperador, @idtipoimagen)
        `);

      const idAdjunto = result.recordset[0].IdAdjunto;
      
      console.log(`✅ Adjunto subido para visita ${data.numeroVisita}: ${idAdjunto} - ${file.originalname}`);
      console.log(`📁 Ruta en servidor: ${rutaArchivo}`);

      return {
        success: true,
        idAdjunto,
        nombreArchivo: file.originalname,
        rutaArchivo: rutaArchivo,
        tipoArchivo: file.mimetype,
        tamanioBytes: file.size
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
      const pool = await connectDB();
      const result = await pool.request().query(`
        SELECT
          LTRIM(RTRIM(CAST(tipoimagen AS VARCHAR(20)))) AS TipoImagen,
          LTRIM(RTRIM(CAST(desctipoimagen AS VARCHAR(120)))) AS DescTipoImagen
        FROM dbo.hctiposimagenes
        WHERE tipoimagen IS NOT NULL
          AND LTRIM(RTRIM(CAST(tipoimagen AS VARCHAR(20)))) <> ''
        ORDER BY desctipoimagen
      `);
      return (result.recordset || []).map((r) => ({
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
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
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
        timeout: 120000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
      });
      return { buffer: Buffer.from(res.data), nombreArchivo };
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

  /**
   * Obtener adjuntos de una visita
   */
  async getAdjuntosPorVisita(numeroVisita) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('numeroVisita', sql.Int, numeroVisita)
        .query(`
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
          WHERE a.NumeroVisita = @numeroVisita
          ORDER BY a.Fecha DESC
        `);

      return result.recordset.map(adj => {
        // Si Descripcion está vacío o no tiene extensión, usar nombre del archivo desde PatchServidor
        let nombreArchivo = adj.Descripcion;
        if (!nombreArchivo || !/\.[a-zA-Z0-9]+$/.test(nombreArchivo)) {
          // Extraer solo el nombre del archivo (última parte después de \ o /)
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
          TipoImagen: adj.idtipoimagen ? adj.idtipoimagen.trim() : null,
          TipoImagenNombre: adj.TipoImagenNombre || 'Sin categoría'
        };
      });
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
      
      // Agrupar por TipoImagenNombre (descripción de la tabla hctiposimagenes)
      const grupos = {};
      
      adjuntos.forEach(adj => {
        const nombreTipo = adj.TipoImagenNombre || 'Sin categoría';
        if (!grupos[nombreTipo]) {
          grupos[nombreTipo] = {
            tipo: adj.TipoImagen,
            nombre: nombreTipo,
            adjuntos: [],
            cantidad: 0
          };
        }
        grupos[nombreTipo].adjuntos.push(adj);
        grupos[nombreTipo].cantidad++;
      });
      
      // Convertir a array y ordenar por cantidad descendente
      const resultado = Object.values(grupos).sort((a, b) => b.cantidad - a.cantidad);
      
      return resultado;
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
      const pool = await connectDB();

      const result = await pool.request()
        .input('idAdjunto', sql.Int, idAdjunto)
        .query(`
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
          WHERE a.IdAdjunto = @idAdjunto
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const adj = result.recordset[0];
      
      // Si Descripcion está vacío o no tiene extensión, usar nombre del archivo desde PatchServidor
      let nombreArchivo = adj.Descripcion;
      if (!nombreArchivo || !/\.[a-zA-Z0-9]+$/.test(nombreArchivo)) {
        // Extraer solo el nombre del archivo (última parte después de \ o /)
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
        FechaCarga: adj.Fecha
      };

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
      const pool = await connectDB();

      // Obtener información del adjunto antes de eliminar
      const adjunto = await this.getAdjuntoPorId(idAdjunto);
      
      if (!adjunto) {
        throw new Error('Adjunto no encontrado');
      }

      // Eliminar archivo físico del servidor
      const FILE_SERVER_URL = process.env.FILE_SERVER_URL || 'http://181.4.71.230:3002';
      
      if (adjunto.RutaArchivo) {
        try {
          const axios = require('axios');
          const encodedPath = encodeURIComponent(adjunto.RutaArchivo);
          const deleteUrl = `${FILE_SERVER_URL}/file?path=${encodedPath}`;
          
          console.log(`🗑️ Eliminando archivo del servidor: ${adjunto.RutaArchivo}`);
          
          const response = await axios.delete(deleteUrl, {
            timeout: 30000
          });
          
          if (response.data.success) {
            console.log(`✅ Archivo físico eliminado: ${adjunto.RutaArchivo}`);
          } else {
            console.warn(`⚠️ Respuesta del servidor: ${response.data.message || 'Error desconocido'}`);
          }
        } catch (fileError) {
          console.warn(`⚠️ No se pudo eliminar archivo físico: ${adjunto.RutaArchivo}`);
          console.warn(`   Error: ${fileError.message}`);
          // Continuar con la eliminación del registro aunque falle la eliminación del archivo
        }
      }

      // Eliminar de la base de datos
      await pool.request()
        .input('idAdjunto', sql.Int, idAdjunto)
        .query('DELETE FROM imPedidosEstudiosAdjuntos WHERE IdAdjunto = @idAdjunto');

      console.log(`✅ Adjunto eliminado de BD: ${idAdjunto}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error al eliminar adjunto:', error);
      throw error;
    }
  }
}

module.exports = new AdjuntosService();
