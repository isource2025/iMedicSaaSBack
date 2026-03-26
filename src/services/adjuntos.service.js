const sql = require('mssql');
const { connectDB } = require('../config/database');
const path = require('path');
const fs = require('fs').promises;

class AdjuntosService {
  /**
   * Subir archivo adjunto para una visita
   */
  async subirAdjunto(data, file, cargadoPor) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('numeroVisita', sql.Int, data.numeroVisita)
        .input('descripcion', sql.NVarChar(255), file.originalname)
        .input('patch', sql.NVarChar(500), file.path)
        .input('fecha', sql.DateTime, new Date())
        .input('idOperador', sql.Int, cargadoPor)
        .query(`
          INSERT INTO imPedidosEstudiosAdjuntos (NumeroVisita, Descripcion, Patch, Fecha, IdOperador)
          OUTPUT INSERTED.IdAdjunto
          VALUES (@numeroVisita, @descripcion, @patch, @fecha, @idOperador)
        `);

      const idAdjunto = result.recordset[0].IdAdjunto;
      
      console.log(`✅ Adjunto subido para visita ${data.numeroVisita}: ${idAdjunto} - ${file.originalname}`);

      return {
        success: true,
        idAdjunto,
        nombreArchivo: file.originalname,
        rutaArchivo: file.path,
        tipoArchivo: file.mimetype,
        tamanioBytes: file.size
      };
    } catch (error) {
      console.error('❌ Error al subir adjunto:', error);
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
            a.Fecha,
            a.IdOperador,
            LTRIM(RTRIM(ISNULL(p.Apellido, '') + ' ' + ISNULL(p.Nombres, ''))) AS NombreOperador
          FROM imPedidosEstudiosAdjuntos a
          LEFT JOIN imPassword p ON a.IdOperador = p.CodOperador
          WHERE a.NumeroVisita = @numeroVisita
          ORDER BY a.Fecha DESC
        `);

      return result.recordset.map(adj => {
        // Si Descripcion está vacío o no tiene extensión, usar nombre del archivo desde PatchServidor
        let nombreArchivo = adj.Descripcion;
        if (!nombreArchivo || !/\.[a-zA-Z0-9]+$/.test(nombreArchivo)) {
          nombreArchivo = path.basename(adj.PatchServidor || '');
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
      });
    } catch (error) {
      console.error('❌ Error al obtener adjuntos por visita:', error);
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
        nombreArchivo = path.basename(adj.PatchServidor || '');
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

      // Eliminar de la base de datos
      await pool.request()
        .input('idAdjunto', sql.Int, idAdjunto)
        .query('DELETE FROM imPedidosEstudiosAdjuntos WHERE IdAdjunto = @idAdjunto');

      // Eliminar archivo físico
      try {
        await fs.unlink(adjunto.RutaArchivo);
        console.log(`✅ Archivo físico eliminado: ${adjunto.RutaArchivo}`);
      } catch (fileError) {
        console.warn(`⚠️ No se pudo eliminar archivo físico: ${adjunto.RutaArchivo}`);
      }

      console.log(`✅ Adjunto eliminado: ${idAdjunto}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error al eliminar adjunto:', error);
      throw error;
    }
  }
}

module.exports = new AdjuntosService();
