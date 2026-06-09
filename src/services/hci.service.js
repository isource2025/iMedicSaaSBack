const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar Historia Clínica de Ingreso (imHCI)
 */
class HCIService {
  
  /**
   * Obtiene la historia clínica por número de visita
   * @param {number} numeroVisita - Número de visita
   * @returns {Promise<Array>} Historias clínicas encontradas
   */
  async getByNumeroVisita(numeroVisita) {
    try {
      console.log(`[HCI SERVICE] 🔍 Buscando HC para visita: ${numeroVisita}`);
      
      const query = `
        SELECT 
          h.*,
          p.Apellido + ' ' + p.Nombres as ProfesionalNombre,
          s.Descripcion as SectorDescripcion
        FROM imHCI h
        LEFT JOIN imPassword p ON h.IdProfecional = p.CodOperador
        LEFT JOIN imSectores s ON h.IdSector = s.Valor
        WHERE h.NumeroVisita = @p0
        ORDER BY h.Fecha DESC
      `;
      
      const result = await executeQuery(query, [
        { value: numeroVisita, type: 'Int' }
      ]);
      
      console.log(`[HCI SERVICE] ✅ ${result.length} registros encontrados`);
      return result;
      
    } catch (error) {
      console.error('[HCI SERVICE] ❌ Error al obtener HC:', error.message);
      throw error;
    }
  }

  /**
   * Obtiene una historia clínica por ID
   * @param {number} id - ID de la historia clínica
   * @returns {Promise<Object>} Historia clínica encontrada
   */
  async getById(id) {
    try {
      console.log(`[HCI SERVICE] 🔍 Buscando HC con ID: ${id}`);
      
      const query = `
        SELECT 
          h.*,
          p.Apellido + ' ' + p.Nombres as ProfesionalNombre,
          s.Descripcion as SectorDescripcion
        FROM imHCI h
        LEFT JOIN imPassword p ON h.IdProfecional = p.CodOperador
        LEFT JOIN imSectores s ON h.IdSector = s.Valor
        WHERE h.IdHCIngreso = @p0
      `;
      
      const result = await executeQuery(query, [
        { value: id, type: 'Int' }
      ]);
      
      if (result.length === 0) {
        throw new Error('Historia clínica no encontrada');
      }
      
      console.log('[HCI SERVICE] ✅ HC encontrada');
      return result[0];
      
    } catch (error) {
      console.error('[HCI SERVICE] ❌ Error al obtener HC:', error.message);
      throw error;
    }
  }

  /**
   * Crea una nueva historia clínica
   * @param {Object} data - Datos de la historia clínica
   * @returns {Promise<Object>} Historia clínica creada
   */
  async crear(data) {
    try {
      console.log('[HCI SERVICE] 📝 Creando nueva HC');
      
      // Construir query dinámicamente basado en campos presentes
      const campos = Object.keys(data).filter(k => data[k] !== undefined && data[k] !== null);
      const valores = campos.map(c => `@${c}`).join(', ');
      const columnas = campos.join(', ');
      
      const query = `
        INSERT INTO imHCI (${columnas})
        OUTPUT INSERTED.*
        VALUES (${valores})
      `;
      
      const params = campos.map(campo => ({
        name: campo,
        type: this.getTipoSQL(campo),
        value: data[campo]
      }));
      
      const result = await executeQuery(query, params);
      
      console.log('[HCI SERVICE] ✅ HC creada exitosamente');
      return result[0];
      
    } catch (error) {
      console.error('[HCI SERVICE] ❌ Error al crear HC:', error.message);
      throw error;
    }
  }

  /**
   * Actualiza una historia clínica existente
   * @param {number} id - ID de la historia clínica
   * @param {Object} data - Datos a actualizar
   * @returns {Promise<Object>} Historia clínica actualizada
   */
  async actualizar(id, data) {
    try {
      console.log(`[HCI SERVICE] 📝 Actualizando HC ID: ${id}`);
      
      const campos = Object.keys(data)
        .filter(k => k !== 'IdHCIngreso' && data[k] !== undefined && data[k] !== null)
        .map(k => `${k} = @${k}`)
        .join(', ');
      
      if (!campos) {
        throw new Error('No hay campos para actualizar');
      }
      
      const query = `
        UPDATE imHCI 
        SET ${campos}
        OUTPUT INSERTED.*
        WHERE IdHCIngreso = @p0
      `;
      
      const params = [
        { value: id, type: 'Int' },
        ...Object.keys(data)
          .filter(k => k !== 'IdHCIngreso' && data[k] !== undefined && data[k] !== null)
          .map(campo => ({
            name: campo,
            type: this.getTipoSQL(campo),
            value: data[campo]
          }))
      ];
      
      const result = await executeQuery(query, params);
      
      if (result.length === 0) {
        throw new Error('Historia clínica no encontrada');
      }
      
      console.log('[HCI SERVICE] ✅ HC actualizada exitosamente');
      return result[0];
      
    } catch (error) {
      console.error('[HCI SERVICE] ❌ Error al actualizar HC:', error.message);
      throw error;
    }
  }

  /**
   * Obtiene historias clínicas por ID de paciente
   * @param {number} idPaciente - ID del paciente
   * @returns {Promise<Array>} Historias clínicas del paciente
   */
  async getByIdPaciente(idPaciente) {
    try {
      console.log(`[HCI SERVICE] 🔍 Buscando HC para paciente ID: ${idPaciente}`);
      
      const query = `
        SELECT 
          h.*,
          v.NUMEROVISITA,
          p.Apellido + ' ' + p.Nombres as ProfesionalNombre,
          s.Descripcion as SectorDescripcion
        FROM imVisita v
        INNER JOIN imHCI h ON v.NUMEROVISITA = h.NumeroVisita
        LEFT JOIN imPassword p ON h.IdProfecional = p.CodOperador
        LEFT JOIN imSectores s ON h.IdSector = s.Valor
        WHERE v.IdPaciente = @p0
        ORDER BY h.Fecha DESC
      `;
      
      const result = await executeQuery(query, [
        { value: idPaciente, type: 'Int' }
      ]);
      
      console.log(`[HCI SERVICE] ✅ ${result.length} registros encontrados`);
      return result;
      
    } catch (error) {
      console.error('[HCI SERVICE] ❌ Error al obtener HC por paciente:', error.message);
      throw error;
    }
  }

  /**
   * Elimina (soft delete) una historia clínica
   * @param {number} id - ID de la historia clínica
   * @returns {Promise<boolean>} True si se eliminó correctamente
   */
  async eliminar(id) {
    try {
      console.log(`[HCI SERVICE] 🗑️ Eliminando HC ID: ${id}`);
      
      // Verificar si existe campo Activo
      const query = `
        DELETE FROM imHCI
        WHERE IdHCIngreso = @id
      `;
      
      await executeQuery(query, [
        { value: id, type: 'Int' }
      ]);
      
      console.log('[HCI SERVICE] ✅ HC eliminada exitosamente');
      return true;
      
    } catch (error) {
      console.error('[HCI SERVICE] ❌ Error al eliminar HC:', error.message);
      throw error;
    }
  }

  /**
   * Determina el tipo SQL para un campo
   * @param {string} campo - Nombre del campo
   * @returns {string} Tipo SQL
   */
  getTipoSQL(campo) {
    // Campos numéricos
    if (campo.includes('Id') || campo === 'NumeroVisita' || campo === 'IdProfecional') {
      return 'Int';
    }
    
    // Campos de fecha
    if (campo === 'Fecha' || campo.includes('DateTime')) {
      return 'DateTime';
    }
    
    // Campos booleanos (bit)
    if (campo.includes('PIELRETRACCION') || campo.includes('ELEVACION') || 
        campo.includes('DENARANJA') || campo.includes('ULCERAS')) {
      return 'Bit';
    }
    
    // Por defecto, varchar
    return 'VarChar';
  }
}

module.exports = new HCIService();
