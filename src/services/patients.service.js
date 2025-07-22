/**
 * Servicio para gestión de pacientes
 */
const { executeQuery } = require('../models/db');
const { v4: uuidv4 } = require('uuid'); // si querés generar un GUID

/**
 * Obtiene todos los pacientes de la tabla impacientes
 * @returns {Promise<Array>} Promise con la lista de pacientes
 */
const obtenerPacientes = async () => {
  try {
    const query = `
      SELECT 
        p.IDPaciente,
        p.Numerodocumento,
        p.ApellidoyNombre,
        p.Domicilio,
        p.Sexo,
        p.NumeroHC,
        CAST(p.FechaNacimiento AS DATETIME) AS FechaNacimiento,        
        p.EstadoCivil,
        c.RazonSocial as Cobertura,
        p.ValorLocalidad,
        p.Provincia,
        p.Nacionalidad,
        p.CUIT,
        p.TelefonoParticular,
        p.TelefonoNegocio,
        p.Mail,
        p.NumeroCuenta,
        p.NumeroSSN
      FROM impacientes p
      LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
      ORDER BY p.ApellidoyNombre
    `;
    
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error al obtener pacientes de la base de datos:', error);
    throw error;
  }
};

/**
 * Busca pacientes por ID, nombre, número de documento o historia clínica
 * @param {string|number} searchTerm - Término de búsqueda (ID, nombre, documento o historia clínica)
 * @returns {Promise<Array>} Promise con la lista de pacientes
 */
const buscarPacientes = async (searchTerm) => {
  try {
    // Convertir el término de búsqueda a string para asegurar compatibilidad
    const searchTermStr = String(searchTerm).trim();
    
    // Construir la consulta SQL con el término de búsqueda directamente en la consulta
    // Nota: Esta no es la mejor práctica desde el punto de vista de seguridad,
    // pero es una solución temporal mientras se resuelve el problema con los parámetros
    const query = `
      SELECT 
        p.IDPaciente,
        p.NumeroDocumento,
        p.ApellidoyNombre,
        p.Domicilio,
        p.Sexo,
        p.NumeroHC,
        DATEADD(DAY, p.FechaNacimiento - 2, '19000101') AS FechaNacimiento,
        p.EstadoCivil,
        c.RazonSocial as Cobertura,
        p.ValorLocalidad,
        l.ValorProvincia as Provincia,
        n.Descripcion as Nacionalidad,
        p.CUIT,
        p.TelefonoParticular,
        p.TelefonoNegocio,
        p.Mail,
        p.NumeroCuenta,
        p.NumeroSSN
      FROM impacientes p
      LEFT JOIN imclientes c ON p.NumeroCuenta = c.Valor
      LEFT JOIN imLocalidades as l ON l.Valor = ValorLocalidad
      LEFT JOIN imProvincia as pr ON pr.LetraProvincia = l.ValorProvincia
      LEFT JOIN imNacionalidad as n ON n.Valor = pr.ValorNacionalidad
      WHERE 
        CAST(p.IDPaciente AS VARCHAR) LIKE '%${searchTermStr}%' OR
        CAST(p.NumeroDocumento AS VARCHAR) LIKE '%${searchTermStr}%' OR
        p.ApellidoyNombre LIKE '%${searchTermStr}%' OR
        CAST(p.NumeroHC AS VARCHAR) LIKE '%${searchTermStr}%'
      ORDER BY p.ApellidoyNombre
    `;
    
    // Ejecutar la consulta sin parámetros
    const result = await executeQuery(query);
    return result;
  } catch (error) {
    console.error('Error al buscar pacientes:', error);
    throw error;
  }
};


/**
 * Obtiene un paciente por su ID
 * @param {number} id - ID del paciente
 * @returns {Promise<Object|null>} Promise con el paciente encontrado o null si no existe
 */
const obtenerPacientePorId = async (id) => {
  try {
    const query = `
      SELECT 
        IDPaciente,
        Numerodocumento,
        ApellidoyNombre,
        Domicilio,
        Sexo,
        NumeroDocumento,
        NumeroHC,
        FechaNacimiento,
        EstadoCivil,
        TipoDocumento,
        ValorLocalidad,
        l.ValorProvincia as Provincia,
        Nacionalidad,
        CUIT,
        TelefonoParticular,
        TelefonoNegocio,
        Mail,
        NumeroCuenta,
        NumeroSSN
      FROM impacientes
      LEFT JOIN imLocalidades as l ON l.Valor = ValorLocalidad
      WHERE IDPaciente = @p0
    `;
    
    const parametros = [{ value: id }];
    const result = await executeQuery(query, parametros);
    
    if (result.length === 0) {
      return null;
    }
    
    return result[0];
  } catch (error) {
    console.error(`Error al obtener paciente con ID ${id}:`, error);
    throw error;
  }
};

/**
 * Crea un nuevo paciente en la tabla impacientes, 
 * convirtiendo nombre de nacionalidad y estado civil en sus códigos FK.
 * @param {Object} pacienteData - Datos enviados desde el front
 * @returns {Promise<Object>} - El paciente recién insertado
 */
const crearPaciente = async (pacienteData) => {
  try {
    // Helper para recortar strings
    const limitLength = (str, max) => {
      if (str == null) return null;
      return str.toString().substring(0, max);
    };

    // 1) Sanitizar datos
    const sd = {
      ListaIDPaciente: limitLength(
        pacienteData.ListaIDPaciente ?? uuidv4(),
        80
      ),
      IDPacienteAlt: pacienteData.IDPacienteAlt != null 
                      ? Number(pacienteData.IDPacienteAlt) 
                      : 0, // Valor por defecto 0 para IDPacienteAlt
      ApellidoyNombre:   limitLength(pacienteData.ApellidoyNombre, 40) || '',
      TipoDocumento:     limitLength(pacienteData.TipoDocumento,   3)  || null,
      NumeroDocumento:   pacienteData.NumeroDocumento != null
                            ? Number(pacienteData.NumeroDocumento)
                            : null,
      Domicilio:         limitLength(pacienteData.Domicilio,       80) || null,
      ValorLocalidad:    pacienteData.ValorLocalidad != null
                            ? Number(pacienteData.ValorLocalidad)
                            : null,
      Provincia:         pacienteData.Provincia != null
                            ? Number(pacienteData.Provincia)
                            : null,
      Nacionalidad:      limitLength(pacienteData.Nacionalidad,    2)  || null,
      Sexo:              limitLength(pacienteData.Sexo,            1)  || null,
      NumeroHC:          limitLength(pacienteData.NumeroHC,       20) || null,
      FechaNacimiento:   pacienteData.FechaNacimiento || null,
      Hora:              pacienteData.Hora != null
                            ? Number(pacienteData.Hora)
                            : null,
      CUIT:              limitLength(pacienteData.CUIT,           13) || null,
      EstadoCivil:       limitLength(pacienteData.EstadoCivil,     1)  || null,
      Religion:          limitLength(pacienteData.Religion,        3)  || null,
      Raza:              pacienteData.Raza != null
                            ? Number(pacienteData.Raza)
                            : null,
      TelefonoParticular: limitLength(pacienteData.TelefonoParticular, 20) || null,
      TelefonoNegocio:    limitLength(pacienteData.TelefonoNegocio,    20) || null,
      Mail:               limitLength(pacienteData.Mail,             80) || null,
      NumeroSSN:          limitLength(pacienteData.NumeroSSN,        40) || null
    };

    // 2) Query (ahora incluye ListaIDPaciente e IDPacienteAlt)
    const query = `
      INSERT INTO impacientes (
        ListaIDPaciente,
        IDPacienteAlt,
        ApellidoyNombre,
        TipoDocumento,
        NumeroDocumento,
        Domicilio,
        ValorLocalidad,
        Provincia,
        Nacionalidad,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        Hora,
        CUIT,
        EstadoCivil,
        Religion,
        Raza,
        TelefonoParticular,
        TelefonoNegocio,
        Mail,
        NumeroSSN
      )
      VALUES (
        @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9,
        @p10, @p11, @p12, @p13, @p14, @p15, @p16, @p17, @p18, @p19, @p20
      );
      SELECT
        IDPaciente,
        ListaIDPaciente,
        IDPacienteAlt,
        ApellidoyNombre,
        TipoDocumento,
        NumeroDocumento,
        Domicilio,
        ValorLocalidad,
        Provincia,
        Nacionalidad,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        Hora,
        CUIT,
        EstadoCivil,
        Religion,
        Raza,
        TelefonoParticular,
        TelefonoNegocio,
        Mail,
        NumeroSSN
      FROM impacientes
      WHERE IDPaciente = SCOPE_IDENTITY();
    `;

    // 3) Parámetros
    const params = [
      { value: sd.ListaIDPaciente },      // @p0
      { value: sd.IDPacienteAlt },        // @p1
      { value: sd.ApellidoyNombre },      // @p2
      { value: sd.TipoDocumento },        // @p3
      { value: sd.NumeroDocumento },      // @p4
      { value: sd.Domicilio },            // @p5
      { value: sd.ValorLocalidad },       // @p6
      { value: sd.Provincia },            // @p7
      { value: sd.Nacionalidad },         // @p8
      { value: sd.Sexo },                 // @p9
      { value: sd.NumeroHC },             // @p10
      { value: sd.FechaNacimiento },      // @p11
      { value: sd.Hora },                 // @p12
      { value: sd.CUIT },                 // @p13
      { value: sd.EstadoCivil },          // @p14
      { value: sd.Religion },             // @p15
      { value: sd.Raza },                 // @p16
      { value: sd.TelefonoParticular },   // @p17
      { value: sd.TelefonoNegocio },      // @p18
      { value: sd.Mail },                 // @p19
      { value: sd.NumeroSSN }             // @p20
    ];

    // 4) Ejecutar y retornar
    const [nuevo] = await executeQuery(query, params);
    return nuevo;

  } catch (error) {
    console.error('Error al crear paciente:', error);
    throw error;
  }
};


/**
 * Actualiza un paciente existente
 * @param {number} id - ID del paciente
 * @param {Object} pacienteData - Datos del paciente
 * @returns {Promise<Object>} Promise con el paciente actualizado
 */
const actualizarPaciente = async (id, pacienteData) => {
  try {
    // Función para limitar la longitud de un string
    const limitLength = (str, maxLength) => {
      if (!str) return '';
      return str.toString().substring(0, maxLength);
    };

    const getNacionalidadQuery = `
      SELECT Valor
      FROM imNacionalidad
      WHERE Descripcion = @p0
    `;

    const parametrosNacionalidad = [
      {value: pacienteData.Nacionalidad}
    ];

    const nacionalidad = await executeQuery(getNacionalidadQuery, parametrosNacionalidad);

    // Sanitizar los datos antes de enviarlos a la BD
    const sanitizedData = {
      ApellidoyNombre: limitLength(pacienteData.ApellidoyNombre, 100) || '',
      TipoDocumento: limitLength(pacienteData.TipoDocumento, 10) || '',
      NumeroDocumento: limitLength(pacienteData.NumeroDocumento, 20) || '',
      Domicilio: limitLength(pacienteData.Domicilio, 100) || '',
      ValorLocalidad: pacienteData.ValorLocalidad || null,
      Provincia: isNaN(pacienteData.Provincia) ? null : pacienteData.Provincia,
      Nacionalidad: limitLength(nacionalidad[0].Valor, 50) || '',
      Sexo: limitLength(pacienteData.Sexo, 1) || '',
      NumeroHC: limitLength(pacienteData.NumeroHC, 20) || '',
      FechaNacimiento: pacienteData.FechaNacimiento || null,
      Hora: pacienteData.Hora || null,
      CUIT: limitLength(pacienteData.CUIT, 20) || '',
      EstadoCivil: limitLength(pacienteData.EstadoCivil, 20) || '',
      Religion: limitLength(pacienteData.Religion, 50) || '',
      Raza: isNaN(pacienteData.Raza) ? null : pacienteData.Raza,
      TelefonoParticular: limitLength(pacienteData.TelefonoParticular, 20) || '',
      TelefonoNegocio: limitLength(pacienteData.TelefonoNegocio, 20) || '',
      Mail: limitLength(pacienteData.Mail, 100) || '',
      NumeroSSN: limitLength(pacienteData.NumeroSSN, 20) || ''
    };

    const query = `
      UPDATE impacientes
      SET 
        ApellidoyNombre = @p1,
        TipoDocumento = @p2,
        NumeroDocumento = @p3,
        Domicilio = @p4,
        ValorLocalidad = @p5,
        Provincia = @p6,
        Nacionalidad = @p7,
        Sexo = @p8,
        NumeroHC = @p9,
        FechaNacimiento = @p10,
        Hora = @p11,
        CUIT = @p12,
        EstadoCivil = @p13,
        Religion = @p14,
        Raza = @p15,
        TelefonoParticular = @p16,
        TelefonoNegocio = @p17,
        Mail = @p18,
        NumeroSSN = @p19
      WHERE IDPaciente = @p0;
      
      SELECT 
        IDPaciente,
        ApellidoyNombre,
        TipoDocumento,
        NumeroDocumento,
        Domicilio,
        ValorLocalidad,
        Provincia,
        Nacionalidad,
        Sexo,
        NumeroHC,
        FechaNacimiento,
        Hora,
        CUIT,
        EstadoCivil,
        Religion,
        Raza,
        TelefonoParticular,
        TelefonoNegocio,
        Mail,
        NumeroSSN
      FROM impacientes
      WHERE IDPaciente = @p0;
    `;
    
    const parametros = [
      { value: id },
      { value: sanitizedData.ApellidoyNombre },
      { value: sanitizedData.TipoDocumento },
      { value: sanitizedData.NumeroDocumento },
      { value: sanitizedData.Domicilio },
      { value: sanitizedData.ValorLocalidad },
      { value: sanitizedData.Provincia },
      { value: sanitizedData.Nacionalidad },
      { value: sanitizedData.Sexo },
      { value: sanitizedData.NumeroHC },
      { value: sanitizedData.FechaNacimiento },
      { value: sanitizedData.Hora },
      { value: sanitizedData.CUIT },
      { value: sanitizedData.EstadoCivil },
      { value: sanitizedData.Religion },
      { value: sanitizedData.Raza },
      { value: sanitizedData.TelefonoParticular },
      { value: sanitizedData.TelefonoNegocio },
      { value: sanitizedData.Mail },
      { value: sanitizedData.NumeroSSN }
    ];

    const result = await executeQuery(query, parametros);
    return result[0];
  } catch (error) {
    console.error('Error al actualizar paciente:', error);
    throw error;
  }
};

/**
 * Elimina un paciente
 * @param {number} id - ID del paciente
 * @returns {Promise<boolean>} Promise con true si se eliminó o false si no existe
 */
const eliminarPaciente = async (id) => {
  try {
    // Primero verificamos si el paciente existe
    const pacienteExistente = await obtenerPacientePorId(id);
    
    if (!pacienteExistente) {
      return false;
    }
    
    const query = `
      DELETE FROM impacientes
      WHERE IDPaciente = @p0
    `;
    
    const parametros = [{ value: id }];
    await executeQuery(query, parametros);
    
    return true;
  } catch (error) {
    console.error(`Error al eliminar paciente con ID ${id}:`, error);
    throw error;
  }
};

/**
 * Obtiene los datos de una visita por su número de visita
 * @param {string|number} numeroVisita - Número de visita a consultar
 * @returns {Promise<Object|null>} Promise con los datos de la visita o null si no existe
 */
const obtenerVisitaPorNumero = async (numeroVisita) => {
  console.log("Numero de visita en servicio:"+ numeroVisita);
  try {
    const query = `
      SELECT 
        v.NumeroVisita,
        v.FechaAdmisionS AS fechaAdmisionS,
        CONVERT(VARCHAR(10), v.FechaAdmisionS, 23) AS fechaAdmision,
        CONVERT(VARCHAR(5), v.FechaAdmisionS, 108) AS horaAdmision,
        dbo.fn_ClarionDATE2SQL(v.FechaEgreso) AS fechaEgreso,
        dbo.fn_ClarionTIME2SQL(v.HoraEgreso) AS horaEgreso,
        v.DisposicionEgreso AS disposicionEgreso,
        v.DiagnosticoEgreso AS diagnosticoEgreso,
        p.IDPaciente AS idPaciente,
        p.ApellidoyNombre AS nombrePaciente,
        h.ValorHabitacionCama AS habitacionCama,
        h.Observaciones AS descripcionHabitacionCama
      FROM 
        imvisita v
      LEFT JOIN 
        impacientes p ON v.IDPaciente = p.IDPaciente
      LEFT JOIN 
        imhabitacioncamas h ON v.NumeroVisita = h.NumeroVisita
      WHERE 
        v.NumeroVisita = @p0
    `;
    
    const parametros = [{ value: numeroVisita }];
    const result = await executeQuery(query, parametros);
    
    if (result.length === 0) {
      return null;
    }
    
    return result[0];
  } catch (error) {
    console.error(`Error al obtener visita con número ${numeroVisita}:`, error);
    throw error;
  }
};

/**
 * Registra el egreso de un paciente
 * @param {Object} egresoData - Datos del egreso
 * @returns {Promise<Object>} Promise con los datos del egreso registrado
 */
const registrarEgresoPaciente = async (egresoData) => {
  try {
    // Actualizar la visita con los datos de egreso
    const queryUpdateVisita = `
      UPDATE imvisitas
      SET 
        FechaEgreso = @p1,
        HoraEgreso = @p2,
        DisposicionEgreso = @p3,
        DiagnosticoEgreso = @p4,
        CodOperadorEgreso = @p5
      WHERE NumeroVisita = @p0;
      
      -- Retornar la visita actualizada
      SELECT 
        NumeroVisita,
        CONVERT(VARCHAR(10), FechaAdmision, 23) AS fechaAdmision,
        CONVERT(VARCHAR(5), HoraAdmision, 108) AS horaAdmision,
        CONVERT(VARCHAR(10), FechaEgreso, 23) AS fechaEgreso,
        CONVERT(VARCHAR(5), HoraEgreso, 108) AS horaEgreso,
        DisposicionEgreso AS disposicionEgreso,
        DiagnosticoEgreso AS diagnosticoEgreso
      FROM imvisitas
      WHERE NumeroVisita = @p0;
    `;
    
    const parametrosVisita = [
      { value: egresoData.numeroVisita },
      { value: egresoData.fechaEgreso },
      { value: egresoData.horaEgreso },
      { value: egresoData.disposicionEgreso },
      { value: egresoData.diagnosticoEgreso || null },
      { value: egresoData.codOperador || null }
    ];
    
    const resultVisita = await executeQuery(queryUpdateVisita, parametrosVisita);
    
    // Si se proporcionó un bedId, actualizar el estado de la cama
    if (egresoData.bedId) {
      const queryUpdateCama = `
        UPDATE imhabitacioncamastmp
        SET 
          EstadoCama = 'DISPONIBLE',
          IDPaciente = NULL
        WHERE ValorHabitacionCama = @p0;
      `;
      
      const parametrosCama = [{ value: egresoData.bedId }];
      await executeQuery(queryUpdateCama, parametrosCama);
    }
    
    return resultVisita[0];
  } catch (error) {
    console.error(`Error al registrar egreso para visita ${egresoData.numeroVisita}:`, error);
    throw error;
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
};
