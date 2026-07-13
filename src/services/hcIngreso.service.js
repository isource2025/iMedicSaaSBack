const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
    fechaCalendarioArgentina,
    horaWallArgentina,
} = require("../utils/dateUtils");
const { normalizarTextoParaClarionAnsi } = require("../utils/clarionText");
const { calcularIMC } = require("../utils/antropometria");

/** Texto libre / memos hacia imHCI (ANSI Clarion). */
function valorTextoHci(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return normalizarTextoParaClarionAnsi(v);
    return String(v);
}

function normalizarNumero(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** Fecha/hora de HC como texto local (evita desfase UTC al persistir en SQL Server). */
function normalizarFechaHci(data) {
    const pad2 = (n) => String(n).padStart(2, "0");

    const fecha = String(data?.fecha || "").trim();
    const horaRaw = String(data?.hora || "00:00").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        const hm = horaRaw.match(/^(\d{1,2}):(\d{2})/);
        const hh = hm ? pad2(Number(hm[1])) : "00";
        const mm = hm ? hm[2] : "00";
        return `${fecha} ${hh}:${mm}:00`;
    }

    if (data?.Fecha) {
        const s = String(data.Fecha).trim();
        const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
        if (m) return `${m[1]} ${m[2]}:${m[3]}:00`;
    }

    return `${fechaCalendarioArgentina()} ${horaWallArgentina(false)}:00`;
}

function normalizarIdSector(value) {
    if (value === undefined || value === null) return "";

    if (typeof value === "object") {
        return normalizarIdSector(value.idSector || value.IdSector || value.sector || "");
    }

    const raw = String(value).trim();
    if (!raw) return "";

    if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
        try {
            return normalizarIdSector(JSON.parse(raw));
        } catch {
            // seguir con fallback string
        }
    }

    const parts = raw.split("-");
    const candidate = parts.length >= 2 ? parts[1] : parts[0];
    return String(candidate || "").trim().slice(0, 4);
}

function resolverCodOperadorDesdeAuth(auth) {
    if (!auth) return null;
    const u = auth.usuario || {};
    const candidates = [u.codOperador, u.idCodOperador, u.CodOperador];
    for (const c of candidates) {
        const n = c != null && c !== '' ? Number(c) : NaN;
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

async function resolverCodOperadorSesion(auth) {
    const fromJwt = resolverCodOperadorDesdeAuth(auth);
    if (fromJwt) return fromJwt;

    const vp = auth?.usuario?.id ?? auth?.usuario?.idValorpersonal ?? auth?.usuario?.valorPersonal;
    const vpNum = vp != null && vp !== '' ? Number(vp) : NaN;
    if (!Number.isFinite(vpNum) || vpNum <= 0) return null;

    try {
        const rows = await executeQuery(
            'SELECT TOP 1 CodOperador FROM dbo.imPassword WHERE ValorPersonal = @p0',
            [{ value: vpNum }],
        );
        const cod = rows[0]?.CodOperador;
        const n = cod != null && cod !== '' ? Number(cod) : NaN;
        if (Number.isFinite(n) && n > 0) return n;
    } catch (err) {
        console.warn('[hcIngreso] resolverCodOperadorSesion:', err.message);
    }
    return null;
}

async function aplicarAutorSesion(data, auth) {
    const next = { ...data };
    const actual = normalizarNumero(next.IdProfecional);
    if (actual <= 0 && auth) {
        const cod = await resolverCodOperadorSesion(auth);
        if (cod) next.IdProfecional = cod;
    }
    return next;
}

/**
 * Guardar signos vitales en tabla de controles frecuentes
 * Esta función se ejecuta automáticamente al crear/editar HC
 * @param {Object} data - Datos de signos vitales y contexto
 * @returns {Promise<Object>} Resultado de la operación
 */
const guardarSignosVitalesEnControles = async (data) => {
    try {
        const fechaClarion = convertirFechaAClarion(fechaCalendarioArgentina());
        const horaClarion = convertirHoraAClarion(horaWallArgentina(true));
        
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
        const imc = calcularIMC(peso, talla);
        const glucemia = data.SV_GLUCEMIA ? parseInt(data.SV_GLUCEMIA) || 0 : 0;
        
        // Verificar si hay al menos un signo vital para guardar
        const haySignosVitales = maximo || minimo || pulso || frecResp || axilar || glucemia || peso || talla || imc;
        
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
                Axilar, Rectal, Hgt, Peso, Talla, IMC,
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
                @param11, @param12, @param13, @param14, @param15, @param16,
                @param17, @param18,
                @param19, @param20, @param21,
                @param22, @param23
            );
        `;
        
        const operadorRaw = normalizarNumero(data.IdProfecional);
        const operador = operadorRaw > 0 ? operadorRaw : 0;
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
            { value: imc },
            { value: 0 },                 // Saturometria
            { value: 0 },                 // PAMedia
            { value: normalizarIdSector(data.IdSector) }, // IdSector
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
            CONVERT(VARCHAR(8), DATEADD(ms, (NULLIF(uc.HoraControl,0) - 1) * 10, 0), 108) AS CTRL_HoraControl,
            hc.[SN _PARESCRANEANOS] AS SN_PARESCRANEANOS
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
            CONVERT(VARCHAR(8), DATEADD(ms, (NULLIF(uc.HoraControl,0) - 1) * 10, 0), 108) AS CTRL_HoraControl,
            hc.[SN _PARESCRANEANOS] AS SN_PARESCRANEANOS
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

// Mapeo de nombres de columnas con typos en la BD (frontend -> BD real)
const COLUMN_NAME_MAP = {
    'SN_PARESCRANEANOS': 'SN _PARESCRANEANOS',  // Typo en la BD: espacio antes del _
};
const mapColumnName = (key) => COLUMN_NAME_MAP[key] || key;

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
    params.push({ value: normalizarIdSector(data.IdSector) });
    paramIndex++;
    
    columns.push('MotivoConsulta');
    values.push(`@param${paramIndex}`);
    params.push({ value: valorTextoHci(data.MotivoConsulta || '') });
    paramIndex++;
    
    columns.push('EnfermedadActual');
    values.push(`@param${paramIndex}`);
    params.push({ value: valorTextoHci(data.EnfermedadActual || '') });
    paramIndex++;
    
    columns.push('IdProfecional');
    values.push(`@param${paramIndex}`);
    params.push({ value: normalizarNumero(data.IdProfecional) });
    paramIndex++;

    columns.push('Fecha');
    values.push(`@param${paramIndex}`);
    // Sin type DateTime: el driver mssql convierte a UTC y desplaza la hora local
    params.push({ value: normalizarFechaHci(data) });
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
        
        columns.push(`[${mapColumnName(key)}]`);
        values.push(`@param${paramIndex}`);
        params.push({ value: valorTextoHci(valor) });
        paramIndex++;
    });
    
    // Campos especiales sin prefijo que también son parte de la HC
    ['ModMedica', 'Semiologia', 'IMPRESIONDIAGNOSTICA', 'COMENTARIODEINGRESO', 'EXAMENCOMPLEMENTARIO', 'IMC'].forEach(campo => {
        if (data[campo] !== undefined && data[campo] !== null) {
            columns.push(`[${campo}]`);
            values.push(`@param${paramIndex}`);
            params.push({ value: valorTextoHci(data[campo]) });
            paramIndex++;
        }
    });
    
    return { columns, values, params };
};

const crearHCIngreso = async (data, auth = null) => {
    try {
        const payload = await aplicarAutorSesion(data, auth);
        const { columns, values, params } = buildDynamicFields(payload);
        
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
            ...payload,
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
const actualizarHCIngreso = async (idHCIngreso, data, auth = null) => {
    try {
        const dataConAutor = await aplicarAutorSesion(data, auth);
        const sincronizarSignosVitales = dataConAutor.sincronizarSignosVitales === true;

        const setClauses = [];
        const params = [{ value: idHCIngreso }]; // @param0 = WHERE
        let paramIndex = 1;

        if (dataConAutor.IdSector !== undefined) {
            setClauses.push(`IdSector = @param${paramIndex}`);
            params.push({ value: normalizarIdSector(dataConAutor.IdSector) });
            paramIndex++;
        }

        if (dataConAutor.MotivoConsulta !== undefined) {
            setClauses.push(`MotivoConsulta = @param${paramIndex}`);
            params.push({ value: valorTextoHci(dataConAutor.MotivoConsulta) });
            paramIndex++;
        }

        if (dataConAutor.EnfermedadActual !== undefined) {
            setClauses.push(`EnfermedadActual = @param${paramIndex}`);
            params.push({ value: valorTextoHci(dataConAutor.EnfermedadActual) });
            paramIndex++;
        }

        if (dataConAutor.IdProfecional !== undefined) {
            setClauses.push(`IdProfecional = @param${paramIndex}`);
            params.push({ value: normalizarNumero(dataConAutor.IdProfecional) });
            paramIndex++;
        }

        if (dataConAutor.fecha !== undefined || dataConAutor.hora !== undefined || dataConAutor.Fecha !== undefined) {
            setClauses.push(`Fecha = @param${paramIndex}`);
            params.push({ value: normalizarFechaHci(dataConAutor) });
            paramIndex++;
        }
        
        // Campos dinámicos del examen físico
        const prefijosValidos = ['SV','PF','TCS','SL','SOAM','C','CU','M','AR','AC','A','AUG','AIG','SN','EO','EC','RDT','PD','PT','AD','EN','MI','MP','EG','DIA'];
        
        Object.keys(dataConAutor).forEach(key => {
            if (key === 'sincronizarSignosVitales') return;
            if (CAMPOS_BASICOS_HCI.includes(key)) return;
            if (key === 'fecha' || key === 'hora') return;
            if (!key.includes('_')) return;
            const prefijo = key.split('_')[0];
            if (!prefijosValidos.includes(prefijo)) return;
            
            const valor = dataConAutor[key];
            if (valor === undefined) return;
            
            setClauses.push(`[${mapColumnName(key)}] = @param${paramIndex}`);
            params.push({ value: valor !== null ? valorTextoHci(valor) : '' });
            paramIndex++;
        });
        
        // Campos especiales sin prefijo
        ['ModMedica', 'Semiologia', 'IMPRESIONDIAGNOSTICA', 'COMENTARIODEINGRESO', 'EXAMENCOMPLEMENTARIO', 'IMC'].forEach(campo => {
            if (dataConAutor[campo] !== undefined) {
                setClauses.push(`[${campo}] = @param${paramIndex}`);
                params.push({ value: dataConAutor[campo] !== null ? valorTextoHci(dataConAutor[campo]) : '' });
                paramIndex++;
            }
        });
        
        if (setClauses.length === 0 && !sincronizarSignosVitales) {
            return { success: true, signosVitalesEnControles: false, sinCambios: true };
        }

        if (setClauses.length > 0) {
            const sql = `
                UPDATE dbo.imHCI
                SET ${setClauses.join(',\n                ')}
                WHERE IdHCIngreso = @param0
            `;

            console.log('[HC Ingreso] Actualizando', setClauses.length, 'campos para IdHCIngreso:', idHCIngreso);
            await executeQuery(sql, params);
        }

        let signosVitalesEnControles = false;
        if (sincronizarSignosVitales) {
            let payloadControles = { ...dataConAutor };
            if (normalizarNumero(payloadControles.IdProfecional) <= 0) {
                const hc = await obtenerHCIngresoPorId(idHCIngreso);
                if (hc?.IdProfecional) payloadControles.IdProfecional = hc.IdProfecional;
                payloadControles = await aplicarAutorSesion(payloadControles, auth);
            }
            const resultadoControles = await guardarSignosVitalesEnControles({
                ...payloadControles,
                IdHCIngreso: idHCIngreso,
                NumeroVisita: dataConAutor.NumeroVisita,
            });
            signosVitalesEnControles = resultadoControles.success;
            console.log('Resultado guardado en controles (signos vitales modificados):', resultadoControles.message);
        }

        return {
            success: true,
            signosVitalesEnControles,
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
