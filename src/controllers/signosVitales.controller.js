const signosVitalesService = require('../services/signosVitales.service');

/**
 * Controlador para Signos Vitales
 * Maneja la integración entre HC y Controles de Enfermería
 */

/**
 * POST /api/signos-vitales
 * Guarda signos vitales con doble guardado automático (HC + Controles)
 */
const guardarSignosVitales = async (req, res) => {
  try {
    const {
      NumeroVisita,
      IdHCIngreso,
      medibles,
      antropometricos,
      OperadorCarga,
      Profesional,
      IdSector
    } = req.body;
    
    // Validaciones básicas
    if (!NumeroVisita) {
      return res.status(400).json({
        success: false,
        mensaje: 'NumeroVisita es requerido'
      });
    }
    
    if (!OperadorCarga || !Profesional) {
      return res.status(400).json({
        success: false,
        mensaje: 'OperadorCarga y Profesional son requeridos'
      });
    }
    
    // Validar que haya al menos algún dato para guardar
    const tieneMedibles = medibles && Object.keys(medibles).some(k => medibles[k] !== null && medibles[k] !== undefined);
    const tieneAntropometricos = antropometricos && Object.keys(antropometricos).some(k => antropometricos[k] !== null && antropometricos[k] !== undefined);
    
    if (!tieneMedibles && !tieneAntropometricos) {
      return res.status(400).json({
        success: false,
        mensaje: 'Debe proporcionar al menos un dato medible o antropométrico'
      });
    }
    
    console.log('[SignosVitales Controller] Guardando signos vitales:', {
      NumeroVisita,
      IdHCIngreso,
      tieneMedibles,
      tieneAntropometricos
    });
    
    const resultado = await signosVitalesService.guardarSignosVitales({
      NumeroVisita,
      IdHCIngreso: IdHCIngreso || null,
      medibles: medibles || {},
      antropometricos: antropometricos || {},
      OperadorCarga,
      Profesional,
      IdSector: IdSector || null
    });
    
    res.status(200).json(resultado);
    
  } catch (error) {
    console.error('[SignosVitales Controller] Error:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al guardar signos vitales',
      error: error.message
    });
  }
};

/**
 * GET /api/signos-vitales/:idHCIngreso
 * Obtiene signos vitales completos (HC + Control asociado)
 */
const obtenerSignosVitales = async (req, res) => {
  try {
    const { idHCIngreso } = req.params;
    
    if (!idHCIngreso) {
      return res.status(400).json({
        success: false,
        mensaje: 'idHCIngreso es requerido'
      });
    }
    
    const resultado = await signosVitalesService.obtenerSignosVitales(parseInt(idHCIngreso));
    
    res.status(200).json({
      success: true,
      data: resultado
    });
    
  } catch (error) {
    console.error('[SignosVitales Controller] Error:', error);
    
    if (error.message === 'Historia clínica no encontrada') {
      return res.status(404).json({
        success: false,
        mensaje: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener signos vitales',
      error: error.message
    });
  }
};

module.exports = {
  guardarSignosVitales,
  obtenerSignosVitales
};
