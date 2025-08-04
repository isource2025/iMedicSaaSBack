const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');
const patientsService = require('../services/patients.service');

/**
 * Obtiene todos los pacientes
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerPacientes = async (req, res) => {
  try {
    const pacientes = await patientsService.obtenerPacientes();
    res.json({
      success: true,
      data: pacientes
    });
  } catch (error) {
    console.error('Error al obtener pacientes:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los pacientes'
    });
  }
};

/**
 * Busca pacientes por ID, nombre, documento o número de historia clínica
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const buscarPacientes = async (req, res) => {
  try {
    const { searchTerm } = req.query;
    
    // Verificar que el término de búsqueda exista y no esté vacío
    if (searchTerm === undefined || searchTerm === null || String(searchTerm).trim() === '') {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere un término de búsqueda'
      });
    }
    
    // Buscar pacientes usando el servicio (ahora acepta números y strings)
    const pacientes = await patientsService.buscarPacientes(searchTerm);
    res.json({
      success: true,
      data: pacientes
    });
  } catch (error) {
    console.error('Error al buscar pacientes:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al buscar pacientes'
    });
  }
};

/**
 * Obtiene un paciente por su ID
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerPacientePorId = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID inválido'
      });
    }
    
    const paciente = await patientsService.obtenerPacientePorId(id);
    
    if (!paciente) {
      return res.status(404).json({
        success: false,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: paciente
    });
  } catch (error) {
    console.error('Error al obtener paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener el paciente'
    });
  }
};

/**
 * Crea un nuevo paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const crearPaciente = async (req, res) => {
  try {
    const { 
      ApellidoyNombre, 
      TipoDocumento, 
      NumeroDocumento, 
      Sexo, 
      NumeroHC, 
      FechaNacimiento, 
      HoraNacimiento, 
      Domicilio, 
      ValorLocalidad, 
      Provincia, 
      Nacionalidad, 
      EstadoCivil, 
      Religion, 
      Raza,
      TelefonoParticular,
      TelefonoNegocio,
      Mail,
      CUIT,
      NumeroAfiliado
    } = req.body;

    // Validación básica
    if (!ApellidoyNombre || !Sexo || !NumeroHC) {
      return res.status(400).json({
        success: false,
        mensaje: 'Faltan campos obligatorios (nombre, sexo y número de historia clínica)'
      });
    }

    // Convertir hora de formato HH:MM a HHMM (entero)
    let horaInt = null;
    if (HoraNacimiento) {
      const [horas, minutos] = HoraNacimiento.split(':').map(Number);
      if (!isNaN(horas) && !isNaN(minutos)) {
        horaInt = horas * 100 + minutos;
      }
    }

    // Preparar datos para la BD
    const pacienteData = {
      ApellidoyNombre,
      TipoDocumento,
      NumeroDocumento,
      Domicilio,
      ValorLocalidad: ValorLocalidad ? parseInt(ValorLocalidad) : null,
      Provincia: Provincia ? parseInt(Provincia) : null,
      Nacionalidad,
      Sexo,
      NumeroHC,
      FechaNacimiento: convertirFechaAClarion(FechaNacimiento), // <-- Transformación crítica
      Hora: horaInt,
      CUIT,
      EstadoCivil,
      Religion,
      Raza: Raza ? parseInt(Raza) : null,
      TelefonoParticular,
      TelefonoNegocio: TelefonoNegocio,
      Mail: Mail,
      NumeroSSN: NumeroAfiliado
    };

    const nuevoPaciente = await patientsService.crearPaciente(pacienteData);

    res.status(201).json({
      success: true,
      mensaje: 'Paciente creado con éxito',
      data: nuevoPaciente
    });

  } catch (error) {
    console.error('Error al crear paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al crear el paciente',
      error: error.message
    });
  }
}

/**
 * Actualiza un paciente existente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const actualizarPaciente = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { 
      ApellidoyNombre, 
      TipoDocumento, 
      NumeroDocumento, 
      Sexo, 
      NumeroHC, 
      FechaNacimiento, 
      HoraNacimiento, 
      Domicilio, 
      ValorLocalidad, 
      Provincia, 
      Nacionalidad, 
      EstadoCivil, 
      Religion, 
      Raza,
      TelefonoParticular,
      TelefonoNegocio,
      Mail,
      CUIT,
      CoberturaMedica,
      NumeroAfiliado,
      ApellidoMadre,
      GrupoSangre,
      FactorSangre,
      LugarNacimiento,
      Ocupacion,
      Observaciones,
      SituacionLaboral,
      NivelDeEstudios,
      DadorOrganos,
      IdiomaPrimario,
      GrupoEtnico,
      Ciudadania,
      EstadoMilitar
    } = req.body;
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID inválido'
      });
    }
    
    // Validación básica
    if (!ApellidoyNombre || !Sexo || !NumeroHC) {
      return res.status(400).json({
        success: false,
        mensaje: 'Faltan campos obligatorios (nombre, sexo y número de historia clínica)'
      });
    }
    
    // Convertir hora de formato HH:MM a HHMM (entero)
    let horaInt = null;
    if (HoraNacimiento) {
      const [horas, minutos] = HoraNacimiento.split(':').map(Number);
      if (!isNaN(horas) && !isNaN(minutos)) {
        horaInt = horas * 100 + minutos;
      }
    }

    // Preparar datos para la BD
    const pacienteData = {
      ApellidoyNombre,
      ApellidoMadre,
      TipoDocumento,
      NumeroDocumento,
      Domicilio,
      ValorLocalidad: ValorLocalidad ? parseInt(ValorLocalidad) : null,
      Provincia: Provincia ? parseInt(Provincia) : null,
      Nacionalidad,
      Sexo,
      NumeroHC,
      FechaNacimiento: convertirFechaAClarion(FechaNacimiento),
      Hora: horaInt,
      CUIT: CUIT,
      EstadoCivil,
      Religion,
      Raza: Raza ? parseInt(Raza) : null,
      TelefonoParticular,
      TelefonoNegocio: TelefonoNegocio,
      Mail: Mail,
      NumeroSSN: NumeroAfiliado,
      GrupoSangre,
      FactorSangre,
      LugarNacimiento,
      Ocupacion: Ocupacion ? parseInt(Ocupacion) : null,
      Observaciones,
      SituacionLaboral,
      NivelDeEstudios,
      DadorOrganos,
      IdiomaPrimario,
      GrupoEtnico,
      Ciudadania,
      EstadoMilitar
    };
    
    const pacienteActualizado = await patientsService.actualizarPaciente(id, pacienteData);
    
    if (!pacienteActualizado) {
      return res.status(404).json({
        success: false,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    res.json({
      success: true,
      mensaje: 'Paciente actualizado con éxito',
      data: pacienteActualizado
    });
  } catch (error) {
    console.error('Error al actualizar paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar el paciente'
    });
  }
};

/**
 * Elimina un paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const eliminarPaciente = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        mensaje: 'ID inválido'
      });
    }
    
    const eliminado = await patientsService.eliminarPaciente(id);
    
    if (!eliminado) {
      return res.status(404).json({
        success: false,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    res.json({
      success: true,
      mensaje: 'Paciente eliminado con éxito'
    });
  } catch (error) {
    console.error('Error al eliminar paciente:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al eliminar el paciente'
    });
  }
};

/**
 * Obtiene todas las tablas de referencia necesarias para el formulario de pacientes
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerTablasReferencia = async (req, res) => {
  try {
    const tablasReferencia = await patientsService.obtenerTablasReferencia();
    
    res.json({
      success: true,
      data: tablasReferencia
    });
  } catch (error) {
    console.error('Error al obtener tablas de referencia:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener las tablas de referencia'
    });
  }
};

/**
 * Obtiene los datos de una visita por su número
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerVisitaPorNumero = async (req, res) => {
  try {
    const numeroVisita = req.params.numeroVisita;
    console.log('Solicitando visita con número:', numeroVisita);
    
    if (!numeroVisita) {
      console.log('Error: No se proporcionó número de visita');
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el número de visita'
      });
    }
    
    // Intentar convertir a entero para validar
    const numeroVisitaInt = parseInt(numeroVisita, 10);
    if (isNaN(numeroVisitaInt)) {
      console.error(`Error: El número de visita '${numeroVisita}' no es un número válido`);
      return res.status(400).json({
        success: false,
        mensaje: `El número de visita '${numeroVisita}' no es un número válido`
      });
    }
    
    const visita = await patientsService.obtenerVisitaPorNumero(numeroVisitaInt);
    console.log('Resultado de consulta de visita:', visita ? 'Encontrada' : 'No encontrada');
    
    if (!visita) {
      return res.status(404).json({
        success: false,
        mensaje: 'Visita no encontrada'
      });
    }
    
    console.log('Enviando datos de visita:', JSON.stringify(visita));
    res.json({
      success: true,
      data: visita
    });
  } catch (error) {
    console.error('Error al obtener visita:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los datos de la visita',
      error: error.message
    });
  }
};

/**
 * Registra el egreso de un paciente
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const registrarEgresoPaciente = async (req, res) => {
  try {
    const egresoData = req.body;
    
    // Validación básica
    if (!egresoData.numeroVisita || !egresoData.fechaEgreso || !egresoData.horaEgreso || !egresoData.disposicionEgreso) {
      return res.status(400).json({
        success: false,
        mensaje: 'Faltan campos obligatorios para el egreso'
      });
    }
    
    // Obtener la visita para validar
    const visitaExistente = await patientsService.obtenerVisitaPorNumero(egresoData.numeroVisita);
    
    if (!visitaExistente) {
      return res.status(404).json({
        success: false,
        mensaje: 'Visita no encontrada'
      });
    }
    
    // Validar que la fecha de egreso sea posterior o igual a la fecha de admisión
    const fechaEgreso = new Date(egresoData.fechaEgreso);
    const fechaAdmision = new Date(visitaExistente.fechaAdmision);
    
    if (fechaEgreso < fechaAdmision) {
      return res.status(400).json({
        success: false,
        mensaje: 'La fecha de egreso no puede ser anterior a la fecha de admisión'
      });
    }
    
    // Si las fechas son iguales, validar las horas
    if (fechaEgreso.getTime() === fechaAdmision.getTime()) {
      const horaEgresoArr = egresoData.horaEgreso.split(':').map(Number);
      const horaAdmisionArr = visitaExistente.horaAdmision.split(':').map(Number);
      
      // Convertir a minutos para comparar fácilmente
      const minutosEgreso = horaEgresoArr[0] * 60 + horaEgresoArr[1];
      const minutosAdmision = horaAdmisionArr[0] * 60 + horaAdmisionArr[1];
      
      if (minutosEgreso <= minutosAdmision) {
        return res.status(400).json({
          success: false,
          mensaje: 'La hora de egreso debe ser posterior a la hora de admisión'
        });
      }
    }
    
    const resultado = await patientsService.registrarEgresoPaciente(egresoData);
    
    res.json({
      success: true,
      mensaje: 'Egreso registrado con éxito',
      data: resultado
    });
  } catch (error) {
    console.error('Error al registrar egreso:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al registrar el egreso'
    });
  }
};



module.exports = {
  obtenerPacientes,
  buscarPacientes,
  obtenerPacientePorId,
  crearPaciente,
  actualizarPaciente,
  eliminarPaciente,
  obtenerVisitaPorNumero,
  registrarEgresoPaciente,
  obtenerTablasReferencia
};
