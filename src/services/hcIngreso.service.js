const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
} = require("../utils/dateUtils");

/**
 * Guardar signos vitales en tabla de controles frecuentes
 * Esta función se ejecuta automáticamente al crear/editar HC
 * @param {Object} data - Datos de signos vitales y contexto
 * @returns {Promise<Object>} Resultado de la operación
 */
const guardarSignosVitalesEnControles = async (data) => {
    try {
        const ahora = new Date();
        const yyyy = ahora.getFullYear();
        const mm = String(ahora.getMonth() + 1).padStart(2, '0');
        const dd = String(ahora.getDate()).padStart(2, '0');
        const hh = String(ahora.getHours()).padStart(2, '0');
        const mi = String(ahora.getMinutes()).padStart(2, '0');
        const ss = String(ahora.getSeconds()).padStart(2, '0');

        const fechaClarion = convertirFechaAClarion(`${yyyy}-${mm}-${dd}`);
        const horaClarion = convertirHoraAClarion(`${hh}:${mi}:${ss}`);
        
        // Parsear presión arterial "120/80" → Maximo: 120, Minimo: 80
        let maximo = 0;
        let minimo = 0;
        if (data.SV_PA) {
            const partes = data.SV_PA.split('/');
            if (partes.length === 2) {
                maximo = parseInt(partes[0]) || 0;
                minimo = parseInt(partes[1]) || 0;
            }
        }
        
        // Convertir valores - usar 0 en vez de NULL (compatibilidad Clarion)
        const pulso = data.SV_FC ? parseInt(data.SV_FC) || 0 : 0;
        const frecResp = data.SV_FR ? parseInt(data.SV_FR) || 0 : 0;
        const axilar = data.SV_TAX ? parseFloat(data.SV_TAX) || 0 : 0;
        const peso = data.SV_PESOACTUAL ? parseFloat(data.SV_PESOACTUAL) || 0 : 0;
        const talla = data.SV_TALLA ? parseFloat(data.SV_TALLA) || 0 : 0;
        const glucemia = data.SV_GLUCEMIA ? parseInt(data.SV_GLUCEMIA) || 0 : 0;
        
        // Verificar si hay al menos un signo vital para guardar
        const haySignosVitales = maximo || minimo || pulso || frecResp || axilar || glucemia || peso || talla;
        
        if (!haySignosVitales) {
            console.log('No hay signos vitales para guardar en controles frecuentes');
            return { success: true, message: 'No hay signos vitales para guardar', data: null };
        }
        
        const sql = `
            INSERT INTO dbo.imInterCtrlFrecuente (
                NumeroVisita,
                FechaCarga, HoraCarga, OperadorCarga, Profesional,
                FechaControl, HoraControl,
                Pulso, Maximo, Minimo, FrecuenciaRespiratoria,
                Axilar, Rectal, Hgt, Peso, Talla,
                Saturometria, PAMedia,
                IdSector, IdTurno, Nroindicacion,
                Observaciones, IdHci
            )
            OUTPUT INSERTED.Valor
            VALUES (
                @param0,
                @param1, @param2, @param3, @param4,
                @param5, @param6,
                @param7, @param8, @param9, @param10,
                @param11, @param12, @param13, @param14, @param15,
                @param16, @param17,
                @param18, @param19, @param20,
                @param21, @param22
            );
        `;
        
        const operador = data.IdProfecional || 0;
        const params = [
            { value: data.NumeroVisita },
            { value: fechaClarion },     // FechaCarga
            { value: horaClarion },       // HoraCarga
            { value: operador },          // OperadorCarga
            { value: operador },          // Profesional
            { value: fechaClarion },      // FechaControl
            { value: horaClarion },       // HoraControl
            { value: pulso },
            { value: maximo },
            { value: minimo },
            { value: frecResp },
            { value: axilar },
            { value: 0 },                 // Rectal
            { value: glucemia },          // Hgt
            { value: peso },
            { value: talla },
            { value: 0 },                 // Saturometria
            { value: 0 },                 // PAMedia
            { value: data.IdSector || '' }, // IdSector
            { value: 0 },                 // IdTurno
            { value: 0 },                 // Nroindicacion
            { value: 'Cargado desde Historia Clínica' },
            { value: data.IdHCIngreso || 0 }  // IdHci - vincula con la HC
        ];
        
        const resultado = await executeQuery(sql, params);
        
        console.log('✅ Signos vitales guardados en controles frecuentes con IdHci:', data.IdHCIngreso, '- Valor:', resultado[0].Valor);
        
        return {
            success: true,
            message: 'Signos vitales guardados en controles frecuentes',
            data: { Valor: resultado[0].Valor }
        };
    } catch (error) {
        console.error('⚠️ Error al guardar signos vitales en controles:', error);
        return {
            success: false,
            error: error.message,
            message: 'Error al guardar signos vitales en controles (HC se guardó correctamente)'
        };
    }
};

/**
 * Obtener HC de Ingreso por visita
 */
const obtenerHCIngresoPorVisita = async (numeroVisita) => {
    const sql = `
        SELECT 
            hc.*,
            CONVERT(VARCHAR(10), hc.Fecha, 23) AS FechaFormateada,
            SUBSTRING(CONVERT(VARCHAR(8), hc.Fecha, 108), 1, 5) AS HoraFormateada,
            LTRIM(RTRIM(ISNULL(pw.Apellido, '') + ' ' + ISNULL(pw.Nombres, ''))) AS ProfesionalNombre,
            sec.Descripcion AS SectorDescripcion,
            uc.Pulso AS CTRL_Pulso,
            uc.Maximo AS CTRL_Maximo,
            uc.Minimo AS CTRL_Minimo,
            uc.FrecuenciaRespiratoria AS CTRL_FrecuenciaRespiratoria,
            uc.Axilar AS CTRL_Axilar,
            uc.Rectal AS CTRL_Rectal,
            uc.Hgt AS CTRL_Glucemia,
            uc.Saturometria AS CTRL_Saturometria,
            uc.PAMedia AS CTRL_PAMedia,
            uc.Peso AS CTRL_Peso,
            uc.Talla AS CTRL_Talla,
            uc.Observaciones AS CTRL_Observaciones,
            CONVERT(VARCHAR(10), DATEADD(day, NULLIF(uc.FechaControl,0) - 4, '1801-01-01'), 23) AS CTRL_FechaControl,
            CONVERT(VARCHAR(8), DATEADD(ms, (NULLIF(uc.HoraControl,0) - 1) * 10, 0), 108) AS CTRL_HoraControl
        FROM dbo.imHCI AS hc
        LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = hc.IdProfecional
        LEFT JOIN dbo.imSectores AS sec ON hc.IdSector = sec.Valor
        OUTER APPLY (
            SELECT TOP 1 cf.*
            FROM dbo.imInterCtrlFrecuente cf
            WHERE cf.IdHci = hc.IdHCIngreso
            ORDER BY cf.Valor DESC
        ) uc
        WHERE hc.NumeroVisita = @param0
        ORDER BY hc.Fecha DESC, hc.IdHCIngreso DESC
    `;

    const params = [{ value: numeroVisita }];

    try {
        const resultado = await executeQuery(sql, params);
        return resultado;
    } catch (error) {
        console.error("Error al obtener HC de Ingreso por visita:", error);
        throw error;
    }
};

/**
 * Obtener HC de Ingreso por ID
 */
const obtenerHCIngresoPorId = async (idHCIngreso) => {
    const sql = `
        SELECT 
            hc.*,
            CONVERT(VARCHAR(10), hc.Fecha, 23) AS FechaFormateada,
            SUBSTRING(CONVERT(VARCHAR(8), hc.Fecha, 108), 1, 5) AS HoraFormateada,
            LTRIM(RTRIM(ISNULL(pw.Apellido, '') + ' ' + ISNULL(pw.Nombres, ''))) AS ProfesionalNombre,
            sec.Descripcion AS SectorDescripcion,
            uc.Pulso AS CTRL_Pulso,
            uc.Maximo AS CTRL_Maximo,
            uc.Minimo AS CTRL_Minimo,
            uc.FrecuenciaRespiratoria AS CTRL_FrecuenciaRespiratoria,
            uc.Axilar AS CTRL_Axilar,
            uc.Rectal AS CTRL_Rectal,
            uc.Hgt AS CTRL_Glucemia,
            uc.Saturometria AS CTRL_Saturometria,
            uc.PAMedia AS CTRL_PAMedia,
            uc.Peso AS CTRL_Peso,
            uc.Talla AS CTRL_Talla,
            uc.Observaciones AS CTRL_Observaciones,
            CONVERT(VARCHAR(10), DATEADD(day, NULLIF(uc.FechaControl,0) - 4, '1801-01-01'), 23) AS CTRL_FechaControl,
            CONVERT(VARCHAR(8), DATEADD(ms, (NULLIF(uc.HoraControl,0) - 1) * 10, 0), 108) AS CTRL_HoraControl
        FROM dbo.imHCI AS hc
        LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = hc.IdProfecional
        LEFT JOIN dbo.imSectores AS sec ON hc.IdSector = sec.Valor
        OUTER APPLY (
            SELECT TOP 1 cf.*
            FROM dbo.imInterCtrlFrecuente cf
            WHERE cf.IdHci = hc.IdHCIngreso
            ORDER BY cf.Valor DESC
        ) uc
        WHERE hc.IdHCIngreso = @param0
    `;

    const params = [{ value: idHCIngreso }];

    try {
        const resultado = await executeQuery(sql, params);
        return resultado.length > 0 ? resultado[0] : null;
    } catch (error) {
        console.error("Error al obtener HC de Ingreso por ID:", error);
        throw error;
    }
};

/**
 * Crear nueva HC de Ingreso
 */
// Lista de campos válidos de imHCI que se pueden insertar/actualizar dinámicamente
// (excluimos IdHCIngreso que es identity, NumeroVisita, Fecha, y los campos base)
const CAMPOS_BASICOS_HCI = ['NumeroVisita', 'IdSector', 'MotivoConsulta', 'EnfermedadActual', 'IdProfecional'];

const buildDynamicFields = (data) => {
    const columns = [];
    const values = [];
    const params = [];
    let paramIndex = 0;
    
    // Campos básicos obligatorios
    columns.push('NumeroVisita');
    values.push(`@param${paramIndex}`);
    params.push({ value: data.NumeroVisita });
    paramIndex++;
    
    columns.push('IdSector');
    values.push(`@param${paramIndex}`);
    params.push({ value: data.IdSector || '' });
    paramIndex++;
    
    columns.push('MotivoConsulta');
    values.push(`@param${paramIndex}`);
    params.push({ value: data.MotivoConsulta || '' });
    paramIndex++;
    
    columns.push('EnfermedadActual');
    values.push(`@param${paramIndex}`);
    params.push({ value: data.EnfermedadActual || '' });
    paramIndex++;
    
    columns.push('IdProfecional');
    values.push(`@param${paramIndex}`);
    params.push({ value: data.IdProfecional || 0 });
    paramIndex++;
    
    // Agregar dinámicamente todos los campos con prefijo (SV_, PF_, TCS_, etc.)
    Object.keys(data).forEach(key => {
        if (CAMPOS_BASICOS_HCI.includes(key)) return;
        // Solo campos con prefijo de sección (contienen _)
        if (!key.includes('_')) return;
        // Verificar que sea un prefijo válido de sección
        const prefijo = key.split('_')[0];
        const prefijosValidos = ['SV','PF','TCS','SL','SOAM','C','CU','M','AR','AC','A','AUG','AIG','SN','EO','EC','RDT','PD','PT','AD','EN','MI','MP','EG','DIA'];
        if (!prefijosValidos.includes(prefijo)) return;
        
        const valor = data[key];
        if (valor === undefined || valor === null) return;
        
        columns.push(key);
        values.push(`@param${paramIndex}`);
        params.push({ value: String(valor) });
        paramIndex++;
    });
    
    // Campos especiales sin prefijo que también son parte de la HC
    ['ModMedica', 'Semiologia', 'IMPRESIONDIAGNOSTICA', 'COMENTARIODEINGRESO', 'EXAMENCOMPLEMENTARIO'].forEach(campo => {
        if (data[campo] !== undefined && data[campo] !== null) {
            columns.push(campo);
            values.push(`@param${paramIndex}`);
            params.push({ value: String(data[campo]) });
            paramIndex++;
        }
    });
    
    return { columns, values, params };
};

const crearHCIngreso = async (data) => {
    try {
        const { columns, values, params } = buildDynamicFields(data);
        
        const sql = `
            INSERT INTO dbo.imHCI (${columns.join(', ')})
            VALUES (${values.join(', ')});
            SELECT SCOPE_IDENTITY() AS IdHCIngreso;
        `;
        
        console.log('[HC Ingreso] Creando con', columns.length, 'campos');
        
        const resultado = await executeQuery(sql, params);
        const idHCIngreso = resultado[0].IdHCIngreso;
        
        // Guardar datos medibles en controles frecuentes con IdHci
        const resultadoControles = await guardarSignosVitalesEnControles({
            ...data,
            IdHCIngreso: idHCIngreso
        });
        
        console.log('Resultado guardado en controles:', resultadoControles.message);
        
        return {
            IdHCIngreso: idHCIngreso,
            signosVitalesEnControles: resultadoControles.success
        };
    } catch (error) {
        console.error("Error al crear HC de Ingreso:", error);
        throw error;
    }
};

/**
 * Actualizar HC de Ingreso
 */
const actualizarHCIngreso = async (idHCIngreso, data) => {
    try {
        // Construir SET dinámicamente con todos los campos recibidos
        const setClauses = [];
        const params = [{ value: idHCIngreso }]; // @param0 = WHERE
        let paramIndex = 1;
        
        // Campos básicos
        setClauses.push(`IdSector = @param${paramIndex}`);
        params.push({ value: data.IdSector || '' });
        paramIndex++;
        
        setClauses.push(`MotivoConsulta = @param${paramIndex}`);
        params.push({ value: data.MotivoConsulta || '' });
        paramIndex++;
        
        setClauses.push(`EnfermedadActual = @param${paramIndex}`);
        params.push({ value: data.EnfermedadActual || '' });
        paramIndex++;
        
        setClauses.push(`IdProfecional = @param${paramIndex}`);
        params.push({ value: data.IdProfecional || 0 });
        paramIndex++;
        
        // Campos dinámicos del examen físico
        const prefijosValidos = ['SV','PF','TCS','SL','SOAM','C','CU','M','AR','AC','A','AUG','AIG','SN','EO','EC','RDT','PD','PT','AD','EN','MI','MP','EG','DIA'];
        
        Object.keys(data).forEach(key => {
            if (CAMPOS_BASICOS_HCI.includes(key)) return;
            if (!key.includes('_')) return;
            const prefijo = key.split('_')[0];
            if (!prefijosValidos.includes(prefijo)) return;
            
            const valor = data[key];
            if (valor === undefined) return;
            
            setClauses.push(`[${key}] = @param${paramIndex}`);
            params.push({ value: valor !== null ? String(valor) : '' });
            paramIndex++;
        });
        
        // Campos especiales sin prefijo
        ['ModMedica', 'Semiologia', 'IMPRESIONDIAGNOSTICA', 'COMENTARIODEINGRESO', 'EXAMENCOMPLEMENTARIO'].forEach(campo => {
            if (data[campo] !== undefined) {
                setClauses.push(`[${campo}] = @param${paramIndex}`);
                params.push({ value: data[campo] !== null ? String(data[campo]) : '' });
                paramIndex++;
            }
        });
        
        const sql = `
            UPDATE dbo.imHCI
            SET ${setClauses.join(',\n                ')}
            WHERE IdHCIngreso = @param0
        `;
        
        console.log('[HC Ingreso] Actualizando', setClauses.length, 'campos para IdHCIngreso:', idHCIngreso);
        
        await executeQuery(sql, params);
        
        // Guardar datos medibles en controles frecuentes (nuevo registro para historial)
        const resultadoControles = await guardarSignosVitalesEnControles({
            ...data,
            IdHCIngreso: idHCIngreso
        });
        
        console.log('Resultado guardado en controles (actualización):', resultadoControles.message);
        
        return { 
            success: true,
            signosVitalesEnControles: resultadoControles.success
        };
    } catch (error) {
        console.error("Error al actualizar HC de Ingreso:", error);
        throw error;
    }
};

/**
 * Eliminar HC de Ingreso
 */
const eliminarHCIngreso = async (idHCIngreso) => {
    const sql = `
        DELETE FROM dbo.imHCI
        WHERE IdHCIngreso = @param0
    `;

    const params = [{ value: idHCIngreso }];

    try {
        await executeQuery(sql, params);
        return { success: true };
    } catch (error) {
        console.error("Error al eliminar HC de Ingreso:", error);
        throw error;
    }
};

module.exports = {
    obtenerHCIngresoPorVisita,
    obtenerHCIngresoPorId,
    crearHCIngreso,
    actualizarHCIngreso,
    eliminarHCIngreso,
    guardarSignosVitalesEnControles,
};
