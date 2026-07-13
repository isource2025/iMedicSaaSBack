const { executeQuery } = require('../models/db');
const hciService = require('./hci.service');
const { convertirFechaAClarion, convertirHoraAClarion, fechaCalendarioArgentina, horaWallArgentina, horaClarionAhoraArgentina } = require('../utils/dateUtils');
const { calcularIMC } = require('../utils/antropometria');

/**
 * Servicio integrado para Signos Vitales
 * Guarda datos medibles en imInterCtrlFrecuente y datos antropométricos en imHCI
 * Reutiliza servicios existentes para evitar duplicación de código
 */
class SignosVitalesService {
  
  /**
   * Guarda signos vitales con doble guardado automático
   * @param {Object} data - Datos completos
   * @param {number} data.NumeroVisita - Número de visita
   * @param {number} data.IdHCIngreso - ID de HC (null para crear, valor para actualizar)
   * @param {Object} data.medibles - Datos medibles (FC, FR, Temp, Presión, etc.)
   * @param {Object} data.antropometricos - Datos antropométricos (Talla, Peso, etc.)
   * @param {number} data.OperadorCarga - Operador que carga
   * @param {number} data.Profesional - Profesional responsable
   * @param {string} data.IdSector - Sector
   * @returns {Promise<Object>} Resultado con IDs
   */
  async guardarSignosVitales(data) {
    try {
      console.log('[SignosVitales] Guardando para visita:', data.NumeroVisita);
      
      const resultado = {
        success: true,
        IdHCIngreso: null,
        IdControl: null,
        mensaje: ''
      };
      
      // 1. Guardar en imHCI (usando servicio existente)
      const datosHCI = this.prepararDatosHCI(data);
      
      if (data.IdHCIngreso) {
        // Actualizar HC existente
        await hciService.actualizar(data.IdHCIngreso, datosHCI);
        resultado.IdHCIngreso = data.IdHCIngreso;
        console.log('[SignosVitales] HC actualizada:', data.IdHCIngreso);
      } else {
        // Crear nueva HC
        const hcCreada = await hciService.crear(datosHCI);
        resultado.IdHCIngreso = hcCreada.IdHCIngreso;
        console.log('[SignosVitales] HC creada:', hcCreada.IdHCIngreso);
      }
      
      // 2. Guardar/actualizar en imInterCtrlFrecuente si hay datos medibles
      if (this.tieneDatosMedibles(data.medibles)) {
        const datosControl = this.prepararDatosControl(data);
        
        // Buscar si ya existe un control para esta HC
        const controlExistente = await this.buscarControlPorHC(data.NumeroVisita, data.IdHCIngreso);
        
        if (controlExistente && data.IdHCIngreso) {
          // Actualizar control existente
          await this.actualizarControl(controlExistente.Valor, datosControl);
          resultado.IdControl = controlExistente.Valor;
          console.log('[SignosVitales] Control actualizado:', controlExistente.Valor);
        } else {
          // Crear nuevo control
          const controlCreado = await this.crearControl(datosControl);
          resultado.IdControl = controlCreado.Valor;
          console.log('[SignosVitales] Control creado:', controlCreado.Valor);
        }
        
        resultado.mensaje = 'Signos vitales guardados en HC y Controles';
      } else {
        resultado.mensaje = 'Signos vitales guardados solo en HC (sin datos medibles)';
      }
      
      return resultado;
      
    } catch (error) {
      console.error('[SignosVitales] Error:', error);
      throw error;
    }
  }
  
  /**
   * Prepara datos para imHCI (solo campos que existen en la tabla)
   */
  prepararDatosHCI(data) {
    const { medibles, antropometricos, NumeroVisita, IdSector, Profesional } = data;
    
    const datosHCI = {
      NumeroVisita,
      IdSector,
      IdProfecional: Profesional,
      Fecha: new Date()
    };
    
    // Datos medibles (como VARCHAR en HC)
    if (medibles) {
      if (medibles.fc) datosHCI.SV_FC = String(medibles.fc);
      if (medibles.fr) datosHCI.SV_FR = String(medibles.fr);
      if (medibles.temperatura) datosHCI.PF_TEMPERATURA = String(medibles.temperatura);
      if (medibles.fc) datosHCI.AC_FRECUENCIACARDIACA = String(medibles.fc);
      if (medibles.pulso) datosHCI.AC_PULSORADIAL = String(medibles.pulso);
    }
    
    // Datos antropométricos
    if (antropometricos) {
      if (antropometricos.talla) datosHCI.SV_TALLA = String(antropometricos.talla);
      if (antropometricos.pesoActual) datosHCI.SV_PESOACTUAL = String(antropometricos.pesoActual);
      if (antropometricos.pesoHabitual) datosHCI.SV_PESOHABITUAL = String(antropometricos.pesoHabitual);
      if (antropometricos.estadoNutricional) datosHCI.SV_ESTADONUTRICIONAL = antropometricos.estadoNutricional;
      if (antropometricos.perimetroAbdominal) datosHCI.A_PERIMETRO = String(antropometricos.perimetroAbdominal);
      if (antropometricos.impresionGeneral) datosHCI.SV_IMPRESIONGENERAL = antropometricos.impresionGeneral;
      const imc = calcularIMC(antropometricos.pesoActual, antropometricos.talla);
      if (imc > 0) datosHCI.IMC = String(imc);
    }
    
    return datosHCI;
  }
  
  /**
   * Prepara datos para imInterCtrlFrecuente
   */
  prepararDatosControl(data) {
    const { medibles, NumeroVisita, OperadorCarga, Profesional, IdSector } = data;
    const fechaClarion = convertirFechaAClarion(fechaCalendarioArgentina());
    const horaWall = horaWallArgentina(true);
    const [hh, mi, ss] = horaWall.split(':');
    const horaCarga = parseInt(`${hh}${mi}${ss}`, 10);
    const horaControl = horaClarionAhoraArgentina();

    const datosControl = {
      NumeroVisita,
      FechaCarga: fechaClarion,
      HoraCarga: horaCarga,
      FechaControl: fechaClarion,
      HoraControl: horaControl,
      OperadorCarga,
      Profesional,
      IdSector
    };
    
    // Agregar datos medibles si existen
    if (medibles) {
      if (medibles.fc || medibles.pulso) datosControl.Pulso = medibles.fc || medibles.pulso;
      if (medibles.fr) datosControl.FrecuenciaRespiratoria = medibles.fr;
      if (medibles.temperatura) datosControl.Axilar = medibles.temperatura;
      if (medibles.presionMax) datosControl.Maximo = medibles.presionMax;
      if (medibles.presionMin) datosControl.Minimo = medibles.presionMin;
      if (medibles.presionMedia) datosControl.PAMedia = medibles.presionMedia;
      if (medibles.saturacion) datosControl.Saturometria = medibles.saturacion;
      if (medibles.glucemia) datosControl.Hgt = medibles.glucemia;
      if (medibles.peso) datosControl.Peso = medibles.peso;
      if (medibles.talla) datosControl.Talla = medibles.talla;
      const imc = calcularIMC(medibles.peso ?? datosControl.Peso, medibles.talla ?? datosControl.Talla);
      if (imc > 0) datosControl.IMC = imc;
      if (medibles.observaciones) datosControl.Observaciones = medibles.observaciones;
    }
    
    return datosControl;
  }
  
  /**
   * Verifica si hay datos medibles
   */
  tieneDatosMedibles(medibles) {
    if (!medibles) return false;
    return !!(medibles.fc || medibles.fr || medibles.temperatura || 
              medibles.presionMax || medibles.saturacion || medibles.glucemia);
  }
  
  /**
   * Busca control existente asociado a una HC
   * (Busca el control más reciente de la misma visita)
   */
  async buscarControlPorHC(numeroVisita, idHCIngreso) {
    if (!idHCIngreso) return null;
    
    try {
      const query = `
        SELECT TOP 1 Valor, NumeroVisita, FechaCarga, HoraCarga
        FROM imInterCtrlFrecuente
        WHERE NumeroVisita = @numeroVisita
        ORDER BY FechaCarga DESC, HoraCarga DESC
      `;
      
      const result = await executeQuery(query, [
        { name: 'numeroVisita', type: 'Int', value: numeroVisita }
      ]);
      
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('[SignosVitales] Error buscando control:', error);
      return null;
    }
  }
  
  /**
   * Crea nuevo control en imInterCtrlFrecuente
   */
  async crearControl(datos) {
    const campos = Object.keys(datos).filter(k => datos[k] !== null && datos[k] !== undefined);
    const valores = campos.map(c => `@${c}`).join(', ');
    const columnas = campos.join(', ');
    
    const query = `
      INSERT INTO imInterCtrlFrecuente (${columnas})
      OUTPUT INSERTED.Valor
      VALUES (${valores})
    `;
    
    const params = campos.map(campo => ({
      name: campo,
      type: this.getTipoSQLControl(campo),
      value: datos[campo]
    }));
    
    const result = await executeQuery(query, params);
    return result[0];
  }
  
  /**
   * Actualiza control existente en imInterCtrlFrecuente
   */
  async actualizarControl(valor, datos) {
    const campos = Object.keys(datos)
      .filter(k => k !== 'Valor' && datos[k] !== null && datos[k] !== undefined)
      .map(k => `${k} = @${k}`)
      .join(', ');
    
    if (!campos) {
      console.log('[SignosVitales] No hay campos para actualizar en control');
      return;
    }
    
    const query = `
      UPDATE imInterCtrlFrecuente 
      SET ${campos}
      WHERE Valor = @valor
    `;
    
    const params = [
      { name: 'valor', type: 'Int', value: valor },
      ...Object.keys(datos)
        .filter(k => k !== 'Valor' && datos[k] !== null && datos[k] !== undefined)
        .map(campo => ({
          name: campo,
          type: this.getTipoSQLControl(campo),
          value: datos[campo]
        }))
    ];
    
    await executeQuery(query, params);
  }
  
  /**
   * Determina tipo SQL para campos de imInterCtrlFrecuente
   */
  getTipoSQLControl(campo) {
    const tipos = {
      'Valor': 'Int',
      'NumeroVisita': 'Int',
      'FechaCarga': 'Int',
      'HoraCarga': 'Int',
      'FechaControl': 'Int',
      'HoraControl': 'Int',
      'OperadorCarga': 'Int',
      'Profesional': 'Int',
      'Pulso': 'TinyInt',
      'Maximo': 'Int',
      'Minimo': 'Int',
      'FrecuenciaRespiratoria': 'Int',
      'PAMedia': 'Int',
      'Saturometria': 'Int',
      'Hgt': 'Int',
      'Nroindicacion': 'Int',
      'IdTurno': 'Int',
      'Axilar': 'Real',
      'Rectal': 'Real',
      'Peso': 'Decimal',
      'Talla': 'Decimal',
      'IMC': 'Decimal',
      'IdSector': 'VarChar',
      'Observaciones': 'VarChar'
    };
    
    return tipos[campo] || 'VarChar';
  }
  
  /**
   * Obtiene signos vitales completos (HC + Control asociado)
   */
  async obtenerSignosVitales(idHCIngreso) {
    try {
      // Obtener HC
      const hc = await hciService.getById(idHCIngreso);
      
      // Obtener control asociado
      const control = await this.buscarControlPorHC(hc.NumeroVisita, idHCIngreso);
      
      return {
        hc,
        control,
        medibles: this.extraerMediblesDeHC(hc),
        antropometricos: this.extraerAntropometricosDeHC(hc)
      };
    } catch (error) {
      console.error('[SignosVitales] Error obteniendo signos vitales:', error);
      throw error;
    }
  }
  
  /**
   * Extrae datos medibles de HC
   */
  extraerMediblesDeHC(hc) {
    return {
      fc: hc.SV_FC || hc.AC_FRECUENCIACARDIACA,
      fr: hc.SV_FR,
      temperatura: hc.PF_TEMPERATURA,
      pulso: hc.AC_PULSORADIAL
    };
  }
  
  /**
   * Extrae datos antropométricos de HC
   */
  extraerAntropometricosDeHC(hc) {
    return {
      talla: hc.SV_TALLA,
      pesoActual: hc.SV_PESOACTUAL,
      pesoHabitual: hc.SV_PESOHABITUAL,
      estadoNutricional: hc.SV_ESTADONUTRICIONAL,
      perimetroAbdominal: hc.A_PERIMETRO,
      impresionGeneral: hc.SV_IMPRESIONGENERAL
    };
  }
}

module.exports = new SignosVitalesService();
