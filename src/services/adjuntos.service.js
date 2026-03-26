const sql = require('mssql');
const { connectDB } = require('../config/database');
const path = require('path');
const fs = require('fs').promises;

class AdjuntosService {
  /**
   * Normalizar tipo de imagen
   */
  normalizarTipoImagen(idtipoimagen) {
    if (!idtipoimagen) return 'OTROS';
    
    // Limpiar espacios y convertir a mayúsculas
    const tipo = idtipoimagen.trim().toUpperCase();
    
    // Mapear variaciones a categorías principales
    if (tipo.startsWith('LAB')) {
      if (tipo.includes('URG') || tipo.includes('EMERG')) return 'LABORATORIO_URGENCIAS';
      if (tipo.includes('CEN')) return 'LABORATORIO_CENTRAL';
      if (tipo.includes('HEMA') || tipo.includes('HEMO')) return 'HEMATOLOGIA';
      if (tipo.includes('BACT')) return 'BACTERIOLOGIA';
      return 'LABORATORIO';
    }
    
    if (tipo.startsWith('RAD') || tipo === 'RFL') return 'RADIOLOGIA';
    
    if (tipo.startsWith('TOM') || tipo.includes('TOMOG')) return 'TOMOGRAFIA';
    
    if (tipo.startsWith('ECO')) return 'ECOGRAFIA';
    
    if (tipo.startsWith('HEMO') || tipo.startsWith('HEMA')) return 'HEMATOLOGIA';
    
    if (tipo.startsWith('ANE') || tipo.startsWith('ANP') || tipo.includes('ANATOMIA')) return 'ANATOMIA_PATOLOGICA';
    
    if (tipo.startsWith('GAS')) return 'GASOMETRIA';
    
    if (tipo.startsWith('CAR')) return 'CARDIOLOGIA';
    
    if (tipo.startsWith('NEUM') || tipo.startsWith('NEU')) return 'NEUMOLOGIA';
    
    if (tipo.includes('URG') || tipo.includes('EMERG') || tipo.includes('GUAR')) return 'URGENCIAS';
    
    return 'OTROS';
  }
  
  /**
   * Obtener nombre legible del tipo de imagen
   */
  getNombreTipoImagen(tipoNormalizado) {
    const nombres = {
      'LABORATORIO': 'Laboratorio',
      'LABORATORIO_URGENCIAS': 'Laboratorio Urgencias',
      'LABORATORIO_CENTRAL': 'Laboratorio Central',
      'RADIOLOGIA': 'Radiología',
      'TOMOGRAFIA': 'Tomografía',
      'ECOGRAFIA': 'Ecografía',
      'HEMATOLOGIA': 'Hematología',
      'ANATOMIA_PATOLOGICA': 'Anatomía Patológica',
      'BACTERIOLOGIA': 'Bacteriología',
      'GASOMETRIA': 'Gasometría',
      'CARDIOLOGIA': 'Cardiología',
      'NEUMOLOGIA': 'Neumología',
      'URGENCIAS': 'Urgencias',
      'OTROS': 'Otros'
    };
    return nombres[tipoNormalizado] || tipoNormalizado;
  }

  /**
   * Subir archivo adjunto para una visita
   */
  async subirAdjunto(data, file, cargadoPor, patchServidor) {
    try {
      const pool = await connectDB();

      // Usar patchServidor (ruta en servidor SQL) en lugar de file.path (ruta local temporal)
      const rutaArchivo = patchServidor || file.path;

      const result = await pool.request()
        .input('numeroVisita', sql.Int, data.numeroVisita)
        .input('descripcion', sql.NVarChar(255), file.originalname)
        .input('patch', sql.NVarChar(500), rutaArchivo)
        .input('patchServidor', sql.NVarChar(500), rutaArchivo)
        .input('fecha', sql.DateTime, new Date())
        .input('idOperador', sql.Int, cargadoPor)
        .query(`
          INSERT INTO imPedidosEstudiosAdjuntos (NumeroVisita, Descripcion, Patch, PatchServidor, Fecha, IdOperador)
          OUTPUT INSERTED.IdAdjunto
          VALUES (@numeroVisita, @descripcion, @patch, @patchServidor, @fecha, @idOperador)
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
            a.idtipoimagen,
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
          // Extraer solo el nombre del archivo (última parte después de \ o /)
          const rutaCompleta = adj.PatchServidor || '';
          nombreArchivo = rutaCompleta.split(/[\\\/]/).pop() || '';
        }
        
        const tipoImagenNormalizado = this.normalizarTipoImagen(adj.idtipoimagen);
        
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
          TipoImagen: tipoImagenNormalizado,
          TipoImagenNombre: this.getNombreTipoImagen(tipoImagenNormalizado)
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
      
      // Agrupar por tipo de imagen
      const grupos = {};
      
      adjuntos.forEach(adj => {
        const tipo = adj.TipoImagen;
        if (!grupos[tipo]) {
          grupos[tipo] = {
            tipo: tipo,
            nombre: adj.TipoImagenNombre,
            adjuntos: [],
            cantidad: 0
          };
        }
        grupos[tipo].adjuntos.push(adj);
        grupos[tipo].cantidad++;
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
